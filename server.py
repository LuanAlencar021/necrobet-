#!/usr/bin/env python3
import argparse
import base64
from email.message import EmailMessage
import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import smtplib
import ssl
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_FILE = ROOT / "data.json"
EMAIL_OUTBOX_FILE = ROOT / "email-outbox.json"
USER_AGENT = "NecroBET/0.1 local prototype"
STATIC_FILES = {
    "index.html",
    "app.js",
    "styles.css",
    "service-worker.js",
    "manifest.webmanifest",
    "NecroBET-logo.png",
    "NecroBET-logo_v2.png",
    "NecroBET-logo_v3.png",
    "WhatsApp_icon.png",
    "Logo-bet.png",
    "Logo-bet_v2.png",
}

SEED = {
    "users": [],
    "leagues": [],
    "people": [
        {
            "name": "Pessoa Publica Demo",
            "type": "publica",
            "image": "NecroBET-logo_v3.png",
            "source": "demo",
            "classification": "Pessoa publica",
            "status": "Vivo",
        }
    ],
    "picks": [],
}

RESET_CODES = {}


def app_url():
    return os.environ.get("NECROBET_APP_URL", "http://147.15.97.110:4173").rstrip("/")


def smtp_config():
    return {
        "host": os.environ.get("NECROBET_SMTP_HOST", "").strip(),
        "port": int(os.environ.get("NECROBET_SMTP_PORT", "587") or 587),
        "user": os.environ.get("NECROBET_SMTP_USER", "").strip(),
        "password": os.environ.get("NECROBET_SMTP_PASSWORD", ""),
        "from": os.environ.get("NECROBET_EMAIL_FROM", "").strip(),
        "tls": os.environ.get("NECROBET_SMTP_TLS", "starttls").strip().lower(),
    }


def read_email_outbox():
    if not EMAIL_OUTBOX_FILE.exists():
        return []
    try:
        return json.loads(EMAIL_OUTBOX_FILE.read_text(encoding="utf-8-sig"))
    except Exception:
        return []


def write_email_outbox(items):
    EMAIL_OUTBOX_FILE.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")


def queue_email(to_email, subject, text):
    import datetime

    items = read_email_outbox()
    items.append(
        {
            "to": mask_email(to_email),
            "subject": subject,
            "text": text,
            "queuedAt": datetime.datetime.utcnow().isoformat() + "Z",
            "reason": "SMTP nao configurado ou falhou",
        }
    )
    write_email_outbox(items[-100:])


def send_email(to_email, subject, text):
    config = smtp_config()
    sender = config["from"] or config["user"]
    if not config["host"] or not sender:
        queue_email(to_email, subject, text)
        return {"status": "queued", "message": "Email registrado na caixa local de saida."}

    message = EmailMessage()
    message["From"] = sender
    message["To"] = to_email
    message["Subject"] = subject
    message.set_content(text)

    try:
        if config["tls"] == "ssl":
            with smtplib.SMTP_SSL(config["host"], config["port"], timeout=12, context=ssl.create_default_context()) as smtp:
                if config["user"]:
                    smtp.login(config["user"], config["password"])
                smtp.send_message(message)
        else:
            with smtplib.SMTP(config["host"], config["port"], timeout=12) as smtp:
                if config["tls"] != "none":
                    smtp.starttls(context=ssl.create_default_context())
                if config["user"]:
                    smtp.login(config["user"], config["password"])
                smtp.send_message(message)
        return {"status": "sent", "message": "Email enviado."}
    except Exception as exc:
        queue_email(to_email, subject, text)
        print(f"Email delivery failed for {mask_email(to_email)}: {exc}", flush=True)
        return {"status": "queued", "message": "Email registrado na caixa local de saida."}


def send_registration_email(email, name):
    subject = "Cadastro concluido no NecroBET"
    text = (
        f"Ola, {name}!\n\n"
        "Seu cadastro no NecroBET foi concluido com sucesso.\n\n"
        f"Acesse o aplicativo em: {app_url()}\n\n"
        "Se voce nao realizou este cadastro, ignore esta mensagem.\n\n"
        "Grupo BQTech"
    )
    return send_email(email, subject, text)


def ensure_data_file():
    if not DATA_FILE.exists():
        DATA_FILE.write_text(json.dumps(SEED, ensure_ascii=False, indent=2), encoding="utf-8")


def read_state():
    ensure_data_file()
    return json.loads(DATA_FILE.read_text(encoding="utf-8-sig"))


def write_state(state):
    DATA_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def normalize_email(email):
    return (email or "").strip().lower()


def email_hash(email):
    return hashlib.sha256(normalize_email(email).encode("utf-8")).hexdigest()


def mask_email(email):
    local, _, domain = normalize_email(email).partition("@")
    if not local or not domain:
        return ""
    visible = local[0] if len(local) <= 2 else f"{local[:2]}{'*' * min(len(local) - 2, 6)}"
    return f"{visible}@{domain}"


def is_valid_email(email):
    return bool(re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", normalize_email(email)))


def make_password_record(password):
    salt = os.urandom(16)
    iterations = 150000
    digest = hashlib.pbkdf2_hmac("sha256", (password or "").encode("utf-8"), salt, iterations, dklen=32)
    return {
        "passwordAlgo": "PBKDF2-SHA256",
        "passwordIterations": iterations,
        "passwordSalt": base64.b64encode(salt).decode("ascii"),
        "passwordHash": base64.b64encode(digest).decode("ascii"),
    }


def legacy_password_hash(password):
    value = password or ""
    hash_value = 2166136261
    for char in value:
        hash_value ^= ord(char)
        hash_value = (hash_value * 16777619) & 0xFFFFFFFF
    return f"local-{hash_value:08x}"


def verify_password(user, password):
    if user.get("passwordAlgo") == "PBKDF2-SHA256" and user.get("passwordSalt") and user.get("passwordHash"):
        salt = base64.b64decode(user["passwordSalt"])
        iterations = int(user.get("passwordIterations") or 150000)
        digest = hashlib.pbkdf2_hmac("sha256", (password or "").encode("utf-8"), salt, iterations, dklen=32)
        return hmac.compare_digest(base64.b64encode(digest).decode("ascii"), user["passwordHash"])
    return user.get("passwordHash") == legacy_password_hash(password)


def find_user_by_email(state, email):
    normalized = normalize_email(email)
    hashed = email_hash(normalized)
    for user in state.get("users", []):
        if user.get("emailHash") == hashed or normalize_email(user.get("email")) == normalized:
            return user
    return None


def migrate_user_email(user, email):
    normalized = normalize_email(email)
    user["emailHash"] = email_hash(normalized)
    user["emailMasked"] = mask_email(normalized)
    user.pop("email", None)


def fetch_json(url):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=8) as response:
        return json.loads(response.read().decode("utf-8"))


def life_status(summary):
    text = f"{summary.get('description') or ''} {summary.get('extract') or ''}".lower()
    if re.search(r"\b(falecido|falecida|morto|morta|morreu|falecimento|died|deceased|dead|death)\b", text):
        return "Falecido"

    wikibase_item = summary.get("wikibase_item") or ""
    if wikibase_item:
        try:
            data = fetch_json(f"https://www.wikidata.org/wiki/Special:EntityData/{urllib.parse.quote(wikibase_item)}.json")
            entity = data.get("entities", {}).get(wikibase_item, {})
            claims = entity.get("claims", {})
            if claims.get("P570"):
                return "Falecido"
        except Exception:
            pass

    return "Vivo"


def person_class(text):
    value = (text or "").lower()
    if re.search(r"cantor|cantora|singer|vocalist|musician|músico|musico|música|musica|composer|compositor|rapper|funk", value):
        return "Musica"
    if re.search(r"político|politico|política|politica|president|presidente|senator|senador|deputado|governador|minister|prime minister", value):
        return "Politica"
    if re.search(r"actor|actress|atriz|ator|apresentador|apresentadora|filmmaker|director|diretor|television|televisão|cinema|comedian|comediante", value):
        return "Cinema/TV"
    if re.search(r"footballer|soccer|jogador|atleta|tennis|boxer|piloto|racing|sport|olympic", value):
        return "Esporte"
    if re.search(r"business|empresario|empresário|executive|ceo|founder|fundador|bilionario|investor", value):
        return "Negocios"
    if re.search(r"writer|author|escritor|journalist|jornalista|poet|poeta", value):
        return "Midia/Literatura"
    if re.search(r"scientist|cientista|physicist|mathematician|researcher|professor|inventor", value):
        return "Ciencia"
    return "Pessoa publica"


def base_name(name):
    cleaned = re.sub(
        r"\b(cantor|cantora|artista|ator|atriz|apresentador|apresentadora|politico|político|politica|política|presidente|president|atleta|empresario|empresário|brasileiro|brasileira)\b",
        "",
        name or "",
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned or name


def normalize_candidate(summary, lang, context):
    image = ""
    if isinstance(summary.get("thumbnail"), dict):
        image = summary["thumbnail"].get("source") or ""
    if not image and isinstance(summary.get("originalimage"), dict):
        image = summary["originalimage"].get("source") or ""

    description = summary.get("description") or summary.get("extract") or ""
    urls = summary.get("content_urls") or {}
    desktop = urls.get("desktop") or {}
    classification = person_class(f"{description} {summary.get('extract') or ''} {context}")
    status = life_status(summary)
    return {
        "id": f"wiki-{lang}-{summary.get('pageid')}",
        "name": summary.get("title") or "",
        "image": image,
        "description": description,
        "classification": classification,
        "status": status,
        "source": f"Wikipedia {lang}",
        "url": desktop.get("page") or "",
    }


def weak_candidate(candidate):
    text = f"{candidate.get('name', '')} {candidate.get('description', '')}".lower()
    title = candidate.get("name", "").lower()
    weak = (
        "desambiguação",
        "desambiguacao",
        "disambiguation",
        "wikimedia",
        "topics referred",
        "same term",
        "programa",
        "television program",
        "campanha presidencial",
        "presidential campaign",
        "elections",
        "eleições",
        "album",
        "álbum",
        "canção",
        "song",
        "língua",
        "lingua",
        "language",
        "demographic",
        "demografia",
        "ethnic group",
    )
    title_only_weak = ("programa", "television program", "album", "Ã¡lbum", "canÃ§Ã£o", "song")
    if any(item in title for item in title_only_weak):
        return True
    text_weak = tuple(item for item in weak if item not in title_only_weak)
    if any(item in text for item in text_weak):
        return True
    return bool(re.search(r"lista de|list of|discografia|filmografia", title))


def candidate_score(candidate, name, context):
    score = 0
    haystack = f"{candidate.get('name', '')} {candidate.get('description', '')} {candidate.get('classification', '')}".lower()
    if base_name(name).lower() in candidate.get("name", "").lower():
        score += 20
    if candidate.get("image"):
        score += 5
    for word in re.sub(r"[^\w\s]", " ", context or "").lower().split():
        if len(word) >= 4 and word in haystack:
            score += 4
    return score


def search_people(name, context=""):
    languages = ["pt", "en"]
    query_hints = [
        "",
        " funk",
        " funk brasileiro",
        " anos 90",
        " anos 2000",
        " presidente",
        " president",
        " politico",
        " política",
        " cantor",
        " cantor brasileiro",
        " cantora",
        " artista",
        " ator",
        " atriz",
        " apresentador",
        " apresentador brasileiro",
        " apresentadora",
        " atleta",
        " empresario",
        " brasileira",
        " brasileiro",
    ]
    title_hints = ["", " (cantor)", " (cantora)", " (músico)", " (musico)", " (ator)", " (atriz)", " (apresentador)", " (político)", " (politico)", " (atleta)", " (empresário)", " (singer)", " (actor)", " (politician)"]
    root_name = base_name(name)
    queries = [name]
    if context:
        queries.extend([f"{name} {context}", f"{root_name} {context}"])

    seen = set()
    items = []

    for lang in languages:
        for hint in title_hints:
            if len(items) >= 8:
                break
            try:
                title = urllib.parse.quote(f"{root_name}{hint}")
                summary = fetch_json(f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/{title}")
                candidate = normalize_candidate(summary, lang, context)
                key = candidate["name"].lower()
                if key and key not in seen and (candidate["image"] or candidate["description"]) and not weak_candidate(candidate):
                    items.append(candidate)
                    seen.add(key)
            except Exception:
                pass

        for query in queries:
            for hint in query_hints:
                if len(items) >= 8:
                    break
                try:
                    search = urllib.parse.quote(f"{query}{hint}")
                    data = fetch_json(f"https://{lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch={search}&srlimit=5&format=json&origin=*")
                    for result in data.get("query", {}).get("search", []):
                        if len(items) >= 8:
                            break
                        title = result.get("title") or ""
                        key = title.lower()
                        if not title or key in seen:
                            continue
                        try:
                            summary = fetch_json(f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/{urllib.parse.quote(title)}")
                            candidate = normalize_candidate(summary, lang, context)
                            if (candidate["image"] or candidate["description"]) and not weak_candidate(candidate):
                                items.append(candidate)
                                seen.add(key)
                        except Exception:
                            pass
                except Exception:
                    pass

    items.sort(key=lambda item: candidate_score(item, name, context), reverse=True)
    return {"query": name, "context": context, "candidates": items}


class Handler(BaseHTTPRequestHandler):
    def send_bytes(self, status, body, content_type):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store" if self.path.startswith("/api/") else "public, max-age=60")
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, status, payload):
        self.send_bytes(status, json.dumps(payload, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    def do_GET(self):
        ensure_data_file()
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/state":
            self.send_bytes(200, DATA_FILE.read_bytes(), "application/json; charset=utf-8")
            return
        if parsed.path == "/api/people-search":
            query = urllib.parse.parse_qs(parsed.query)
            name = (query.get("name") or [""])[0].strip()
            context = (query.get("context") or [""])[0].strip()
            self.send_json(200, search_people(name, context) if name else {"query": "", "candidates": []})
            return
        if parsed.path == "/api/photo":
            query = urllib.parse.parse_qs(parsed.query)
            name = (query.get("name") or [""])[0].strip()
            results = search_people(name)
            candidate = (results["candidates"] or [{}])[0]
            self.send_json(200, {"image": candidate.get("image", ""), "source": candidate.get("source", ""), "title": candidate.get("name", "")})
            return

        relative = "index.html" if parsed.path == "/" else parsed.path.lstrip("/")
        if relative not in STATIC_FILES:
            self.send_bytes(404, b"Not found", "text/plain; charset=utf-8")
            return
        target = (ROOT / relative).resolve()
        if not str(target).startswith(str(ROOT)) or not target.is_file():
            self.send_bytes(404, b"Not found", "text/plain; charset=utf-8")
            return
        content_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        self.send_bytes(200, target.read_bytes(), content_type)

    def do_PUT(self):
        self.handle_state_write()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.startswith("/api/auth/") or parsed.path == "/api/league/invite":
            self.handle_api_post(parsed.path)
            return
        self.handle_state_write()

    def read_json_body(self):
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def handle_api_post(self, path):
        try:
            payload = self.read_json_body()
        except Exception:
            self.send_json(400, {"ok": False, "error": "Invalid JSON"})
            return

        state = read_state()

        if path == "/api/auth/login":
            email = normalize_email(payload.get("email"))
            password = payload.get("password") or ""
            user = find_user_by_email(state, email)
            if not user or not verify_password(user, password):
                self.send_json(401, {"ok": False, "error": "Email ou senha invalidos."})
                return
            migrate_user_email(user, email)
            write_state(state)
            self.send_json(200, {"ok": True, "userId": user["id"], "state": state})
            return

        if path == "/api/auth/register":
            name = (payload.get("name") or "").strip()
            email = normalize_email(payload.get("email"))
            password = payload.get("password") or ""
            if not name or not is_valid_email(email) or len(password) < 6:
                self.send_json(400, {"ok": False, "error": "Dados de cadastro invalidos."})
                return
            existing = find_user_by_email(state, email)
            if existing and existing.get("passwordHash"):
                self.send_json(409, {"ok": False, "error": "Este email ja esta cadastrado."})
                return
            user = existing or {
                "id": f"usr_{secrets.token_hex(8)}",
                "createdAt": __import__("datetime").datetime.utcnow().isoformat() + "Z",
            }
            user["emailHash"] = email_hash(email)
            user["emailMasked"] = mask_email(email)
            user["name"] = name
            user.update(make_password_record(password))
            if not existing:
                state.setdefault("users", []).append(user)
            write_state(state)
            email_result = send_registration_email(email, name)
            self.send_json(200, {"ok": True, "userId": user["id"], "state": state, "email": email_result})
            return

        if path == "/api/auth/forgot":
            email = normalize_email(payload.get("email"))
            user = find_user_by_email(state, email)
            if not user:
                self.send_json(404, {"ok": False, "error": "Email nao encontrado."})
                return
            code = str(secrets.randbelow(900000) + 100000)
            RESET_CODES[email_hash(email)] = code
            self.send_json(200, {"ok": True, "resetCode": code})
            return

        if path == "/api/auth/reset":
            email = normalize_email(payload.get("email"))
            code = str(payload.get("code") or "")
            password = payload.get("password") or ""
            key = email_hash(email)
            user = find_user_by_email(state, email)
            if not user or RESET_CODES.get(key) != code or len(password) < 6:
                self.send_json(400, {"ok": False, "error": "Codigo ou senha invalidos."})
                return
            user.update(make_password_record(password))
            migrate_user_email(user, email)
            user["passwordResetAt"] = __import__("datetime").datetime.utcnow().isoformat() + "Z"
            RESET_CODES.pop(key, None)
            write_state(state)
            self.send_json(200, {"ok": True, "state": state})
            return

        if path == "/api/league/invite":
            league_id = payload.get("leagueId")
            email = normalize_email(payload.get("email"))
            if not league_id or not is_valid_email(email):
                self.send_json(400, {"ok": False, "error": "Convite invalido."})
                return
            league = next((item for item in state.get("leagues", []) if item.get("id") == league_id), None)
            if not league:
                self.send_json(404, {"ok": False, "error": "Liga nao encontrada."})
                return
            user = find_user_by_email(state, email)
            if not user:
                user = {
                    "id": f"usr_{secrets.token_hex(8)}",
                    "emailHash": email_hash(email),
                    "emailMasked": mask_email(email),
                    "name": mask_email(email),
                    "invitedAt": __import__("datetime").datetime.utcnow().isoformat() + "Z",
                }
                state.setdefault("users", []).append(user)
            league.setdefault("members", [])
            if user["id"] not in league["members"]:
                league["members"].append(user["id"])
            league.setdefault("invitedEmails", [])
            if mask_email(email) not in league["invitedEmails"]:
                league["invitedEmails"].append(mask_email(email))
            write_state(state)
            self.send_json(200, {"ok": True, "state": state})
            return

        self.send_json(404, {"ok": False, "error": "Not found"})

    def handle_state_write(self):
        if urllib.parse.urlparse(self.path).path != "/api/state":
            self.send_bytes(404, b"Not found", "text/plain; charset=utf-8")
            return
        try:
            payload = self.read_json_body()
            write_state(payload)
            self.send_json(200, {"ok": True})
        except Exception:
            self.send_bytes(400, b"Invalid JSON", "text/plain; charset=utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=4173, type=int)
    args = parser.parse_args()
    ensure_data_file()
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"NecroBET running on http://{args.host}:{args.port}")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
