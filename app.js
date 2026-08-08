const SESSION_KEY = "necrobet.session.v1";
const LOGO_SRC = "NecroBET-logo_v3.png";

const seed = {
  users: [],
  leagues: [],
  people: [
    {
      name: "Pessoa Publica Demo",
      type: "publica",
      image: LOGO_SRC,
      source: "demo",
      status: "Vivo",
    },
  ],
  picks: [],
};

let state = clone(seed);
let view = {
  tab: "ligas",
  modal: null,
  selectedLeagueId: null,
  pendingPickName: "",
  publicFigureAnswer: "",
  publicFigureDetails: "",
  showPublicRefine: false,
  identifying: false,
  candidateResults: [],
  authMode: "login",
  pendingEmail: "",
  generatedCode: "",
  loading: true,
  pendingJoinCode: new URLSearchParams(window.location.search).get("join") || "",
  leagueView: "mine",
  joinQuery: "",
  rankingView: "picks",
};

let session = loadSession();

function loadSession() {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveSession(nextSession) {
  session = nextSession;
  if (nextSession) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
  } else {
    localStorage.removeItem(SESSION_KEY);
  }
}

async function loadState() {
  view.loading = true;
  render();
  try {
    const response = await fetch("api/state", { cache: "no-store" });
    if (!response.ok) throw new Error("state");
    const data = await response.json();
    state = { ...clone(seed), ...data };
    view.selectedLeagueId = view.selectedLeagueId || userLeagues()[0]?.id || null;
    await autoJoinFromInvite();
  } catch {
    toast("Nao consegui carregar o arquivo data.json.");
  } finally {
    view.loading = false;
    render();
  }
}

async function saveState() {
  const response = await fetch("api/state", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state),
  });
  if (!response.ok) {
    toast("Nao consegui salvar no data.json.");
    throw new Error("save");
  }
}

async function apiPost(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({ ok: false }));
  return response.ok ? data : { ok: false, ...data };
}

async function persistAndRender() {
  await saveState();
  render();
}

function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function usersPlusIcon() {
  return `
    <svg class="users-plus-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15 19.5v-1.2c0-1.7-1.4-3.1-3.1-3.1H6.6c-1.7 0-3.1 1.4-3.1 3.1v1.2" />
      <path d="M9.2 11.5a3.1 3.1 0 1 0 0-6.2 3.1 3.1 0 0 0 0 6.2Z" />
      <path d="M17.5 8v6" />
      <path d="M14.5 11h6" />
    </svg>`;
}

function leaveLeagueIcon() {
  return `
    <svg class="leave-league-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 5H5.8c-.9 0-1.6.7-1.6 1.6v10.8c0 .9.7 1.6 1.6 1.6H9" />
      <path d="M14.5 8l4 4-4 4" />
      <path d="M18.5 12H8.8" />
    </svg>`;
}

function joinLeagueIcon() {
  return `
    <svg class="join-league-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h11" />
      <path d="M12 8l4 4-4 4" />
      <path d="M19 5v14" />
    </svg>`;
}

function enterLeagueIcon() {
  return `
    <svg class="enter-league-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h12" />
      <path d="M13 7l5 5-5 5" />
    </svg>`;
}

function normalizePersonKey(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function personByName(name) {
  const key = normalizePersonKey(name);
  return state.people.find((person) => normalizePersonKey(person.name) === key) || null;
}

function personStatus(person) {
  return person?.status === "Falecido" ? "Falecido" : "Vivo";
}

function statusChipHtml(status) {
  const safeStatus = status === "Falecido" ? "Falecido" : "Vivo";
  return `<span class="status-chip ${safeStatus === "Falecido" ? "dead" : "alive"}">${safeStatus}</span>`;
}

function classificationChipHtml(classification) {
  return classification ? `<span class="chip">${escapeHtml(classification)}</span>` : "";
}

function personPickCount(personName) {
  const key = normalizePersonKey(personName);
  return state.picks.filter((pick) => normalizePersonKey(pick.personName) === key).length;
}

function personOdd(leagueId, personName) {
  const odd = 1 - Math.max(0, personPickCount(personName) - 1) * 0.05;
  return Math.max(0.05, odd).toFixed(2);
}

function userLabel(userId) {
  const user = state.users.find((item) => item.id === userId);
  return user?.name || userEmailLabel(user) || "Participante";
}

function leagueParticipantIds(league) {
  const ids = new Set(league.members || []);
  state.picks
    .filter((pick) => pick.leagueId === league.id)
    .forEach((pick) => ids.add(pick.userId));
  return [...ids];
}

function leagueUserScore(leagueId, userId) {
  return state.picks
    .filter((pick) => pick.leagueId === leagueId && pick.userId === userId)
    .reduce((score, pick) => {
      const person = personByName(pick.personName);
      if (personStatus(person) !== "Falecido") return score;
      return score + Number(personOdd(leagueId, pick.personName));
    }, 0);
}

function leagueStandings(league) {
  return leagueParticipantIds(league)
    .map((userId) => ({ userId, score: leagueUserScore(league.id, userId) }))
    .sort((a, b) => b.score - a.score || userLabel(a.userId).localeCompare(userLabel(b.userId)));
}

function leagueSearchResults(query) {
  const term = String(query || "").trim().toLowerCase();
  if (!term) return [];
  return state.leagues
    .filter((league) => league.code.toLowerCase().includes(term) || league.name.toLowerCase().includes(term))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 8);
}

function userLeaguePosition(league, userId) {
  const standings = leagueStandings(league);
  const index = standings.findIndex((row) => row.userId === userId);
  return index >= 0 ? index + 1 : standings.length || 1;
}

function isActiveLeague(league) {
  if (!league?.expiresAt) return true;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expires = new Date(`${league.expiresAt}T00:00:00`);
  return Number.isNaN(expires.getTime()) || expires >= today;
}

function userTotalPicks(userId) {
  return state.picks.filter((pick) => pick.userId === userId).length;
}

function userTotalScore(userId) {
  return state.leagues
    .filter((league) => isActiveLeague(league) && leagueParticipantIds(league).includes(userId))
    .reduce((total, league) => total + leagueUserScore(league.id, userId), 0);
}

function oddChipHtml(leagueId, personName) {
  return `<span class="odd-chip">Odd: ${personOdd(leagueId, personName)}</span>`;
}

function currentUser() {
  return state.users.find((user) => user.id === session?.userId) || null;
}

function userLeagues() {
  const user = currentUser();
  if (!user) return [];
  return state.leagues.filter((league) => league.members.includes(user.id));
}

function currentLeague() {
  return state.leagues.find((league) => league.id === view.selectedLeagueId) || userLeagues()[0] || null;
}

function leaguePicks(leagueId, userOnly = true) {
  return state.picks.filter((pick) => {
    const sameLeague = pick.leagueId === leagueId;
    const sameUser = !userOnly || pick.userId === session?.userId;
    return sameLeague && sameUser;
  });
}

function appHtml() {
  if (view.loading) return loadingHtml();
  if (!session || !currentUser()) return authHtml();
  if (view.tab === "liga" && currentLeague()) return leagueDetailHtml(currentLeague());
  return homeHtml();
}

function loadingHtml() {
  return `
    <section class="screen auth-screen">
      <div class="brand">
        <img src="${LOGO_SRC}" alt="NecroBET">
        <div><span>Carregando data.json</span></div>
      </div>
    </section>`;
}

function authHtml() {
  const codeHint = view.generatedCode ? `<p class="small">Codigo local de recuperacao: <strong>${view.generatedCode}</strong></p>` : "";
  const forms = {
    login: `
      <form class="stack" data-action="login-email">
        <div class="field">
          <label for="email">Email</label>
          <input id="email" name="email" type="email" autocomplete="email" placeholder="voce@email.com" required>
        </div>
        <div class="field">
          <label for="password">Senha</label>
          <input id="password" name="password" type="password" autocomplete="current-password" placeholder="Sua senha" required>
        </div>
        <button class="primary-button" type="submit">Entrar</button>
        <button class="text-link" type="button" data-action="show-forgot">Esqueci minha senha</button>
        <button class="text-link" type="button" data-action="show-register">Criar cadastro</button>
      </form>`,
    register: `
      <form class="stack" data-action="register-email">
        <div class="field">
          <label for="name">Seu nome</label>
          <input id="name" name="name" autocomplete="name" placeholder="Nome para aparecer nas ligas" required>
        </div>
        <div class="field">
          <label for="email">Email</label>
          <input id="email" name="email" type="email" autocomplete="email" placeholder="voce@email.com" required>
        </div>
        <div class="field">
          <label for="password">Senha</label>
          <input id="password" name="password" type="password" autocomplete="new-password" minlength="6" placeholder="Minimo 6 caracteres" required>
        </div>
        <button class="primary-button" type="submit">Cadastrar</button>
        <button class="ghost-button" type="button" data-action="show-login">↩ Ja tenho cadastro</button>
      </form>`,
    forgot: `
      <form class="stack" data-action="forgot-password">
        <div class="field">
          <label for="email">Email cadastrado</label>
          <input id="email" name="email" type="email" autocomplete="email" placeholder="voce@email.com" required>
        </div>
        <button class="primary-button" type="submit">Gerar codigo</button>
        <button class="ghost-button" type="button" data-action="show-login">↩ Voltar</button>
      </form>`,
    reset: `
      <form class="stack" data-action="reset-password">
        <div class="field">
          <label for="code">Codigo recebido</label>
          <input id="code" name="code" inputmode="numeric" maxlength="6" placeholder="000000" required>
        </div>
        <div class="field">
          <label for="password">Nova senha</label>
          <input id="password" name="password" type="password" autocomplete="new-password" minlength="6" placeholder="Minimo 6 caracteres" required>
        </div>
        ${codeHint}
        <button class="primary-button" type="submit">Alterar senha</button>
        <button class="ghost-button" type="button" data-action="show-login">↩ Voltar</button>
      </form>`,
  };

  return `
    <section class="screen auth-screen">
      <div class="auth-brand">
        <img src="${LOGO_SRC}" alt="NecroBET">
      </div>
      <div class="panel stack">
        ${forms[view.authMode] || forms.login}
      </div>
      <p class="login-footer">App do grupo BQTech</p>
    </section>`;
}

function homeHtml() {
  const user = currentUser();
  return `
    <section class="screen">
      ${topbarHtml(user?.name || "", false)}
      ${tabHtml()}
      <nav class="bottom-nav">
        ${navButton("ligas", "Ligas")}
        ${navButton("ranking", "Ranking")}
        ${navButton("perfil", "Perfil")}
      </nav>
      ${modalHtml()}
    </section>`;
}

function leagueDetailHtml(league) {
  const picks = leaguePicks(league.id);
  const score = leagueUserScore(league.id, session?.userId);
  const position = userLeaguePosition(league, session?.userId);
  const totalParticipants = Math.max(1, leagueParticipantIds(league).length);
  const views = {
    mine: picks.length
      ? picks.map((pick) => personCardHtml(personByName(pick.personName), pick)).join("")
      : `<div class="empty">Nenhum palpite seu nesta liga ainda.</div>`,
    all: leagueAllPicksHtml(league),
    members: leagueMembersHtml(league),
  };
  const activeView = views[view.leagueView] ? view.leagueView : "mine";
  return `
    <section class="screen">
      ${topbarHtml(league.name, true)}
      <div class="panel stack">
        <div class="row between">
          <div>
            <p class="eyebrow">Liga ativa</p>
            <h2 class="league-name">${escapeHtml(league.name)}</h2>
            <p class="small">Validade: ${formatDate(league.expiresAt)} | Codigo: ${league.code}</p>
          </div>
        </div>
        <div class="league-scorebox">
          <span class="odds">Palpites: ${picks.length}</span>
          <span class="score-badge">Pontos: ${score.toFixed(2)}</span>
          <span class="rank-badge">Rank: ${position}/${totalParticipants}</span>
        </div>
        <div class="league-action-grid">
          <button class="league-icon-action bet-image-button" data-modal="pick" title="Adicionar palpite" aria-label="Adicionar palpite">
            <img src="Logo-bet_v2.png" alt="">
          </button>
          <button class="league-icon-action add-users-button" data-modal="invite" data-id="${league.id}" title="Adicionar usuarios" aria-label="Adicionar usuarios">
            ${usersPlusIcon()}
          </button>
          <button class="league-icon-action whatsapp-button" data-action="share-league" data-id="${league.id}" title="Compartilhar no WhatsApp" aria-label="Compartilhar no WhatsApp">
            <img class="whatsapp-icon" src="WhatsApp_icon.png" alt="" />
          </button>
          <button class="league-icon-action leave-league-button" data-action="leave-league" data-id="${league.id}" title="Sair da liga" aria-label="Sair da liga">
            ${leaveLeagueIcon()}
          </button>
        </div>
      </div>
      <div class="tabs league-tabs" style="margin-top: 12px;">
        <button class="tab ${activeView === "mine" ? "active" : ""}" data-league-view="mine">Meus</button>
        <button class="tab ${activeView === "all" ? "active" : ""}" data-league-view="all">Todos</button>
        <button class="tab ${activeView === "members" ? "active" : ""}" data-league-view="members">Membros</button>
      </div>
      <div class="stack" style="margin-top: 12px;">
        ${views[activeView]}
      </div>
      ${modalHtml()}
    </section>`;
}

function topbarHtml(title, showBack) {
  return `
    <header class="topbar row between">
      <div class="brand">
        <img src="${LOGO_SRC}" alt="NecroBET">
        <div>
          <h1>${escapeHtml(title || "NecroBET")}</h1>
          <span>${showBack ? "Dentro da liga" : "NecroBET"}</span>
        </div>
      </div>
      ${showBack ? `<button class="icon-button" title="Voltar" data-tab="ligas" aria-label="Voltar">↩</button>` : `<button class="icon-button" title="Sair" data-action="logout">Sair</button>`}
    </header>`;
}

function summaryHtml() {
  const leagues = userLeagues();
  const totalPicks = userTotalPicks(session?.userId);
  const totalScore = userTotalScore(session?.userId);
  return `
    <div class="panel stack">
      <div class="metric-grid">
        <div class="metric"><strong>${leagues.length}</strong><span class="small">ligas</span></div>
        <div class="metric"><strong>${totalPicks}</strong><span class="small">palpites</span></div>
        <div class="metric"><strong>${totalScore.toFixed(2)}</strong><span class="small">pontos</span></div>
      </div>
    </div>`;
}

function tabHtml() {
  if (view.tab === "ligas") return leaguesHtml();
  if (view.tab === "ranking") return rankingHtml();
  return profileHtml();
}

function navButton(id, label) {
  return `<button class="nav-item ${view.tab === id ? "active" : ""}" data-tab="${id}">${label}</button>`;
}

function leaguesHtml() {
  const leagues = userLeagues();
  return `
    <div class="stack" style="margin-top: 12px;">
      ${summaryHtml()}
      <div class="row">
        <button class="primary-button" data-modal="league">Criar liga</button>
        <button class="ghost-button" data-modal="join">Acessar</button>
      </div>
      ${
        leagues.length
          ? leagues.map(leagueCardHtml).join("")
          : `<div class="empty">Crie ou acesse uma liga para registrar palpites.</div>`
      }
    </div>`;
}

function leagueCardHtml(league) {
  const active = currentLeague()?.id === league.id ? "active" : "";
  return `
    <article class="league-card ${active}" data-action="open-league" data-id="${league.id}">
      <div class="row between">
        <div>
          <h3 class="league-name">${escapeHtml(league.name)}</h3>
          <p class="small">Validade: ${formatDate(league.expiresAt)}</p>
        </div>
        <span class="odds">${league.code}</span>
      </div>
      <div class="chip-row">
        <span class="chip">${league.members.length} participantes</span>
        <span class="chip">${leaguePicks(league.id).length} palpites seus</span>
      </div>
      <button class="primary-button league-enter-button" data-action="open-league" data-id="${league.id}">
        Entrar na liga ${enterLeagueIcon()}
      </button>
    </article>`;
}

function personCardHtml(person, pick, showOwner = false) {
  const image = person?.image || initialsImage(pick.personName);
  const classification = classificationChipHtml(person?.classification);
  const canDelete = pick.userId === session?.userId;
  const owner = showOwner ? `<p class="small">Palpite de ${escapeHtml(userLabel(pick.userId))}</p>` : "";
  const status = personStatus(person);
  return `
    <article class="person-card">
      <img class="avatar" src="${image}" alt="">
      <div>
        <h3 class="person-name">${escapeHtml(pick.personName)}</h3>
        ${owner}
        <div class="chip-row">${statusChipHtml(status)}${classification}${oddChipHtml(pick.leagueId, pick.personName)}</div>
      </div>
      <div class="pick-actions">
        ${canDelete ? `<button class="delete-pick-button" title="Excluir palpite" data-action="delete-pick" data-id="${escapeHtml(pick.id)}">Excluir</button>` : ""}
      </div>
    </article>`;
}

function leagueAllPicksHtml(league) {
  const groups = new Map();
  const allPicks = state.picks.filter((pick) => pick.leagueId === league.id);
  for (const pick of allPicks) {
    const key = normalizePersonKey(pick.personName);
    if (!groups.has(key)) {
      groups.set(key, {
        personName: pick.personName,
        person: personByName(pick.personName),
        picks: [],
      });
    }
    groups.get(key).picks.push(pick);
  }

  const rows = [...groups.values()].sort((a, b) => {
    const countDiff = b.picks.length - a.picks.length;
    return countDiff || a.personName.localeCompare(b.personName);
  });

  if (!rows.length) return `<div class="empty">Nenhum palpite cadastrado nesta liga ainda.</div>`;

  return rows
    .map((row) => {
      const image = row.person?.image || initialsImage(row.personName);
      const uniqueUsers = [...new Map(row.picks.map((pick) => [pick.userId, pick])).values()];
      const owners = uniqueUsers
        .map((pick) => `<span class="member-chip">${escapeHtml(userLabel(pick.userId))}</span>`)
        .join("");
      const classification = classificationChipHtml(row.person?.classification);
      const status = personStatus(row.person);
      return `
        <article class="grouped-pick-card">
          <img class="avatar" src="${image}" alt="">
          <div class="grouped-pick-body">
            <div class="row between">
              <div>
                <h3 class="person-name">${escapeHtml(row.personName)}</h3>
                <p class="small">${row.picks.length} indicacao(oes) | ${uniqueUsers.length} participante(s)</p>
              </div>
            </div>
            <div class="chip-row">${statusChipHtml(status)}${classification}${oddChipHtml(league.id, row.personName)}</div>
            <div class="pick-owner-list">${owners}</div>
          </div>
        </article>`;
    })
    .join("");
}

function leagueMembersHtml(league) {
  const participantIds = leagueParticipantIds(league);
  if (!participantIds.length) return `<div class="empty">Nenhum membro nesta liga ainda.</div>`;
  const standings = leagueStandings(league);

  return participantIds
    .sort((a, b) => {
      const rankA = standings.findIndex((row) => row.userId === a);
      const rankB = standings.findIndex((row) => row.userId === b);
      return rankA - rankB;
    })
    .map((memberId) => {
      const picks = state.picks.filter((pick) => pick.leagueId === league.id && pick.userId === memberId);
      const rank = userLeaguePosition(league, memberId);
      const score = leagueUserScore(league.id, memberId);
      const pickList = picks.length
        ? picks
            .map((pick) => {
              const person = personByName(pick.personName);
              const image = person?.image || initialsImage(pick.personName);
              const status = personStatus(person);
              const classification = classificationChipHtml(person?.classification);
              return `
                <div class="member-pick-row">
                  <img class="mini-avatar" src="${image}" alt="">
                  <div class="member-pick-info">
                    <strong>${escapeHtml(pick.personName)}</strong>
                    <div class="chip-row">${statusChipHtml(status)}${classification}${oddChipHtml(league.id, pick.personName)}</div>
                  </div>
                </div>`;
            })
            .join("")
        : `<p class="small">Ainda nao cadastrou palpites.</p>`;
      return `
        <article class="member-card">
          <div class="row between">
            <div>
              <h3 class="person-name">${escapeHtml(userLabel(memberId))}</h3>
              <p class="small">Rank: ${rank} | Pontos: ${score.toFixed(2)} | ${picks.length} palpite(s)</p>
            </div>
            <div class="member-card-badges">
              ${memberId === league.ownerId ? `<span class="chip">Dono</span>` : ""}
              <span class="count-badge">${picks.length}</span>
            </div>
          </div>
          <div class="member-picks">${pickList}</div>
        </article>`;
    })
    .join("");
}

function rankingHtml() {
  const activeView = view.rankingView === "players" ? "players" : "picks";
  return `
    <div class="tabs ranking-tabs" style="margin-top: 12px;">
      <button class="tab ${activeView === "picks" ? "active" : ""}" data-ranking-view="picks">Palpites</button>
      <button class="tab ${activeView === "players" ? "active" : ""}" data-ranking-view="players">Jogadores</button>
    </div>
    ${activeView === "players" ? rankingPlayersHtml() : rankingPicksHtml()}`;
}

function rankingPicksHtml() {
  const groups = new Map();
  for (const pick of state.picks) {
    const key = normalizePersonKey(pick.personName);
    if (!groups.has(key)) {
      groups.set(key, {
        name: pick.personName,
        person: personByName(pick.personName),
        pickIds: new Set(),
        leagueIds: new Set(),
        userIds: new Set(),
      });
    }
    const group = groups.get(key);
    group.pickIds.add(pick.id);
    group.leagueIds.add(pick.leagueId);
    group.userIds.add(pick.userId);
  }
  const rows = [...groups.values()].sort((a, b) => b.pickIds.size - a.pickIds.size || a.name.localeCompare(b.name));
  if (!rows.length) return `<div class="empty">O ranking aparece quando houver palpites cadastrados.</div>`;
  return `
    <div class="stack" style="margin-top: 12px;">
      ${rows
        .map(
          (row, index) => `
        <article class="ranking-card">
          <img class="avatar" src="${row.person?.image || initialsImage(row.name)}" alt="">
          <div>
            <strong>#${index + 1} ${escapeHtml(row.name)}</strong>
            <p class="small">${row.pickIds.size} indicacao(oes) em ${row.leagueIds.size} liga(s)</p>
            <div class="chip-row">${statusChipHtml(personStatus(row.person))}${classificationChipHtml(row.person?.classification)}${oddChipHtml("", row.name)}</div>
          </div>
          <span class="count-badge">${row.pickIds.size}</span>
        </article>`
        )
        .join("")}
    </div>`;
}

function rankingPlayersHtml() {
  const activeLeagues = state.leagues.filter(isActiveLeague);
  const playerIds = new Set();
  activeLeagues.forEach((league) => leagueParticipantIds(league).forEach((userId) => playerIds.add(userId)));
  const rows = [...playerIds]
    .map((userId) => {
      const leagues = activeLeagues.filter((league) => leagueParticipantIds(league).includes(userId));
      return {
        userId,
        name: userLabel(userId),
        score: userTotalScore(userId),
        picks: state.picks.filter((pick) => pick.userId === userId && leagues.some((league) => league.id === pick.leagueId)).length,
        leagues: leagues.length,
      };
    })
    .sort((a, b) => b.score - a.score || b.picks - a.picks || a.name.localeCompare(b.name))
    .slice(0, 20);

  if (!rows.length) return `<div class="empty">O ranking de jogadores aparece quando houver ligas ativas.</div>`;

  return `
    <div class="stack" style="margin-top: 12px;">
      ${rows
        .map(
          (row, index) => `
        <article class="player-ranking-card">
          <div>
            <strong>#${index + 1} ${escapeHtml(row.name)}</strong>
            <p class="small">${row.picks} palpite(s) em ${row.leagues} liga(s) ativa(s)</p>
          </div>
          <span class="score-badge">${row.score.toFixed(2)}</span>
        </article>`
        )
        .join("")}
    </div>`;
}

function profileHtml() {
  const user = currentUser();
  return `
    <div class="stack" style="margin-top: 12px;">
      <div class="panel stack">
        <h2 class="league-name">${escapeHtml(user?.name || "")}</h2>
        <p class="small">${escapeHtml(userEmailLabel(user))}</p>
        <form class="stack" data-action="update-profile">
          <div class="field">
            <label for="profile-name">Nome exibido</label>
            <input id="profile-name" name="name" value="${escapeHtml(user?.name || "")}" autocomplete="name" required>
          </div>
          <button class="primary-button" type="submit">Salvar nome</button>
        </form>
        <button class="danger-button" data-action="logout">Sair</button>
      </div>
    </div>`;
}

function modalHtml() {
  if (!view.modal) return "";
  const content = {
    league: leagueModal(),
    join: joinModal(),
    invite: inviteModal(),
    pick: pickModal(),
    identify: identifyModal(),
  }[view.modal.type];
  return `
    <div class="modal-backdrop" data-action="close-modal">
      <div class="modal stack" role="dialog" aria-modal="true">
        <button class="icon-button modal-back-button" title="Voltar" data-action="close-modal" aria-label="Voltar">↩</button>
        ${content}
      </div>
    </div>`;
}

function leagueModal() {
  return `
    <h2 class="league-name">Nova liga</h2>
    <form class="stack" data-action="create-league">
      <div class="field">
        <label for="league-name">Nome</label>
        <input id="league-name" name="name" placeholder="Amigos 2026" required>
      </div>
      <div class="field">
        <label for="expires">Data de validade</label>
        <input id="expires" name="expires" type="date" required>
      </div>
      <button class="primary-button" type="submit">Criar e entrar</button>
      <button class="ghost-button" type="button" data-action="close-modal">Cancelar</button>
    </form>`;
}

function joinModal() {
  const results = leagueSearchResults(view.joinQuery);
  return `
    <h2 class="league-name">Acessar liga</h2>
    <form class="stack" data-action="join-league-search">
      <div class="field">
        <label for="code">Codigo ou nome da liga</label>
        <input id="code" name="code" value="${escapeHtml(view.joinQuery)}" placeholder="NB1234 ou nome da liga" data-action="join-query" required>
      </div>
      <button class="primary-button" type="submit">Pesquisar</button>
      <button class="ghost-button" type="button" data-action="close-modal">Cancelar</button>
    </form>
    <div class="stack">
      ${
        view.joinQuery
          ? results.length
            ? results.map(joinResultCardHtml).join("")
            : `<div class="empty">Nenhuma liga encontrada.</div>`
          : `<p class="small">Digite parte do codigo ou do nome para procurar.</p>`
      }
    </div>`;
}

function joinResultCardHtml(league) {
  return `
    <article class="join-result-card">
      <div>
        <h3 class="league-name">${escapeHtml(league.name)}</h3>
        <p class="small">Codigo: ${escapeHtml(league.code)} | ${league.members.length} participante(s)</p>
      </div>
      <button class="icon-button join-result-button" data-action="join-result" data-code="${escapeHtml(league.code)}" title="Ingressar" aria-label="Ingressar">
        ${joinLeagueIcon()}
      </button>
    </article>`;
}

function inviteModal() {
  return `
    <h2 class="league-name">Adicionar participantes</h2>
    <p class="small">Use contatos do aparelho quando disponivel ou informe um email manualmente.</p>
    <form class="stack" data-action="invite-email">
      <button class="primary-button" type="button" data-action="pick-contacts">Buscar contatos</button>
      <div class="field">
        <label for="invite-email">Email</label>
        <input id="invite-email" name="email" type="email" placeholder="convidado@email.com">
      </div>
      <button class="ghost-button" type="submit">Adicionar email</button>
      <button class="ghost-button" type="button" data-action="close-modal">Fechar</button>
    </form>`;
}

function pickModal() {
  const league = currentLeague();
  const options = state.people.map((person) => `<option value="${escapeHtml(person.name)}"></option>`).join("");
  return `
    <h2 class="league-name">Novo palpite</h2>
    <p class="small">Liga: ${escapeHtml(league?.name || "")}</p>
    <form class="stack" data-action="add-pick">
      <div class="field">
        <label for="person">Nome da pessoa</label>
        <input id="person" name="person" list="people-list" autocomplete="off" placeholder="Digite ou escolha" required>
        <datalist id="people-list">${options}</datalist>
      </div>
      <p class="small">O app vai buscar candidatos publicos e pedir confirmacao antes de salvar.</p>
      <button class="primary-button" type="submit">Buscar</button>
    </form>`;
}

function identifyModal() {
  const name = view.pendingPickName;
  const league = currentLeague();
  const candidates = view.candidateResults || [];
  const noCandidates = candidates.length === 0;
  const shouldAsk = noCandidates || view.showPublicRefine;
  if (view.identifying) {
    return `
      <h2 class="league-name">Buscando ${escapeHtml(name)}</h2>
      <p class="small">Liga: ${escapeHtml(league?.name || "")}</p>
      <div class="loading-box">
        <div class="hourglass">⌛</div>
        <p>Consultando a Wikipedia...</p>
      </div>`;
  }
  return `
    <h2 class="league-name">Quem e ${escapeHtml(name)}?</h2>
    <p class="small">Liga: ${escapeHtml(league?.name || "")}</p>
    <div class="stack">
      ${
        !shouldAsk
          ? candidates.map(candidateCardHtml).join("")
          : publicFigurePromptHtml(name)
      }
      ${!shouldAsk ? `<button class="ghost-button" data-action="show-public-refine">Nao e nenhuma dessas</button>` : ""}
      <button class="ghost-button" data-action="save-private-person">Salvar como contato privado</button>
      <button class="ghost-button" data-modal="pick">Buscar outro nome</button>
    </div>`;
}

function publicFigurePromptHtml(name) {
  return `
    <div class="empty">Nao encontrei uma pessoa publica provavel para ${escapeHtml(name)}.</div>
    <form class="stack" data-action="refine-public-person">
      <p class="small">Ela e uma pessoa do convivio pessoal ou uma figura publica?</p>
      <div class="segmented">
        <label>
          <input type="radio" name="personScope" value="private" data-action="toggle-person-scope" required>
          <span>Convivio</span>
        </label>
        <label>
          <input type="radio" name="personScope" value="public" data-action="toggle-person-scope" required>
          <span>Publica</span>
        </label>
      </div>
      <div class="field">
        <label for="public-category">O que ela e?</label>
        <select id="public-category" name="category" data-public-field>
          <option value="">Selecione se for publica</option>
          <option value="cantor">Cantor/Cantora</option>
          <option value="artista">Artista/Ator/Atriz</option>
          <option value="politico">Politico/Politica</option>
          <option value="apresentador">Apresentador/TV</option>
          <option value="atleta">Atleta</option>
          <option value="empresario">Empresario/Executivo</option>
          <option value="influenciador">Influenciador</option>
          <option value="outra figura publica">Outra figura publica</option>
        </select>
      </div>
      <button class="primary-button" type="submit">Refinar busca</button>
    </form>`;
}

function candidateCardHtml(candidate) {
  const image = candidate.image || initialsImage(candidate.name);
  const status = candidate.status === "Falecido" ? "Falecido" : "Vivo";
  const disabled = status === "Falecido" ? "disabled" : "";
  const classification = classificationChipHtml(candidate.classification || "Pessoa publica");
  return `
    <article class="candidate-card">
      <img class="candidate-avatar" src="${image}" alt="">
      <div class="candidate-body">
        <div class="row between">
          <h3 class="person-name">${escapeHtml(candidate.name)}</h3>
        </div>
        <div class="chip-row">${statusChipHtml(status)}${classification}</div>
        <p class="small">${escapeHtml(candidate.description || candidate.source || "")}</p>
        <button class="primary-button" data-action="choose-candidate" data-id="${escapeHtml(candidate.id)}" ${disabled}>
          ${status === "Falecido" ? "Nao pode ser adicionado" : "Escolher esta pessoa"}
        </button>
      </div>
    </article>`;
}

function render() {
  document.querySelector("#app").innerHTML = appHtml();
}

document.addEventListener("submit", async (event) => {
  const form = event.target.closest("form");
  if (!form) return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  const action = form.dataset.action;
  try {
    if (action === "login-email") await loginEmail(data);
    if (action === "register-email") await registerEmail(data);
    if (action === "forgot-password") await forgotPassword(data.email);
    if (action === "reset-password") await resetPassword(data);
    if (action === "create-league") await createLeague(data);
    if (action === "join-league-search") {
      view.joinQuery = data.code || "";
      render();
    }
    if (action === "invite-email") await inviteEmail(data.email);
    if (action === "add-pick") await identifyPerson(data.person);
    if (action === "refine-public-person") await refinePublicPerson(data);
    if (action === "update-profile") await updateProfile(data);
  } catch {
    toast("Algo falhou ao processar a acao.");
  }
});

document.addEventListener("click", async (event) => {
  const target = event.target.closest("button, [data-action='open-league']");
  if (!target) return;
  if (target.dataset.tab) {
    view.tab = target.dataset.tab;
    render();
  }
  if (target.dataset.leagueView) {
    view.leagueView = target.dataset.leagueView;
    render();
  }
  if (target.dataset.rankingView) {
    view.rankingView = target.dataset.rankingView;
    render();
  }
  if (target.dataset.modal) {
    view.modal = { type: target.dataset.modal, leagueId: target.dataset.id || currentLeague()?.id };
    render();
  }
  if (target.dataset.action === "close-modal") {
    view.modal = null;
    render();
  }
  if (target.dataset.action === "show-login") {
    view.authMode = "login";
    view.generatedCode = "";
    render();
  }
  if (target.dataset.action === "show-register") {
    view.authMode = "register";
    view.generatedCode = "";
    render();
  }
  if (target.dataset.action === "show-forgot") {
    view.authMode = "forgot";
    view.generatedCode = "";
    render();
  }
  if (target.dataset.action === "logout") {
    saveSession(null);
    view.tab = "ligas";
    render();
  }
  if (target.dataset.action === "open-league") {
    view.selectedLeagueId = target.dataset.id;
    view.tab = "liga";
    view.leagueView = "mine";
    render();
  }
  if (target.dataset.action === "join-result") {
    await joinLeague(target.dataset.code);
  }
  if (target.dataset.action === "pick-contacts") {
    await pickContacts();
  }
  if (target.dataset.action === "choose-candidate") {
    await addPickFromCandidate(target.dataset.id);
  }
  if (target.dataset.action === "save-private-person") {
    await addPrivatePick(view.pendingPickName);
  }
  if (target.dataset.action === "show-public-refine") {
    view.showPublicRefine = true;
    render();
  }
  if (target.dataset.action === "delete-pick") {
    await deletePick(target.dataset.id);
  }
  if (target.dataset.action === "share-league") {
    shareLeague(target.dataset.id);
  }
  if (target.dataset.action === "leave-league") {
    await leaveLeague(target.dataset.id);
  }
});

document.addEventListener("click", (event) => {
  if (event.target.classList.contains("modal-backdrop")) {
    view.modal = null;
    render();
  }
});

document.addEventListener("change", (event) => {
  const target = event.target.closest("[data-action='toggle-person-scope']");
  if (!target) return;
  const isPrivate = target.value === "private" && target.checked;
  document.querySelectorAll("[data-public-field]").forEach((field) => {
    field.disabled = isPrivate;
    if (isPrivate) field.value = "";
  });
});

document.addEventListener("input", (event) => {
  const target = event.target.closest("[data-action='join-query']");
  if (!target) return;
  view.joinQuery = target.value;
  render();
  const input = document.querySelector("[data-action='join-query']");
  if (input) {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
});

async function loginEmail({ email, password }) {
  const result = await apiPost("api/auth/login", { email, password });
  if (!result.ok) return toast(result.error || "Email ou senha invalidos.");
  state = { ...clone(seed), ...result.state };
  saveSession({ userId: result.userId, verifiedAt: new Date().toISOString() });
  await autoJoinFromInvite();
  render();
  toast(result.email?.status === "sent" ? "Cadastro concluido. Email enviado." : "Cadastro concluido. Email de confirmacao registrado.");
}

async function registerEmail({ name, email, password }) {
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) return toast("Informe um email valido.");
  if (String(password || "").length < 6) return toast("A senha precisa ter pelo menos 6 caracteres.");
  const result = await apiPost("api/auth/register", { name, email: normalized, password });
  if (!result.ok) return toast(result.error || "Nao consegui cadastrar.");
  state = { ...clone(seed), ...result.state };
  saveSession({ userId: result.userId, verifiedAt: new Date().toISOString() });
  await autoJoinFromInvite();
  render();
}

async function forgotPassword(email) {
  const normalized = normalizeEmail(email);
  const result = await apiPost("api/auth/forgot", { email: normalized });
  if (!result.ok) return toast(result.error || "Email nao encontrado.");
  view.pendingEmail = normalized;
  view.generatedCode = result.resetCode;
  view.authMode = "reset";
  render();
  toast("Codigo local gerado para recuperacao.");
}

async function resetPassword({ code, password }) {
  if (code !== view.generatedCode) return toast("Codigo invalido.");
  if (String(password || "").length < 6) return toast("A senha precisa ter pelo menos 6 caracteres.");
  const result = await apiPost("api/auth/reset", { email: view.pendingEmail, code, password });
  if (!result.ok) return toast(result.error || "Nao consegui alterar a senha.");
  state = { ...clone(seed), ...result.state };
  view.authMode = "login";
  view.generatedCode = "";
  view.pendingEmail = "";
  render();
  toast("Senha alterada.");
}

async function updateProfile({ name }) {
  const user = currentUser();
  const nextName = String(name || "").trim();
  if (!user || nextName.length < 2) return toast("Informe um nome valido.");
  user.name = nextName;
  await persistAndRender();
  toast("Nome atualizado.");
}

async function createLeague({ name, expires }) {
  const user = currentUser();
  const league = {
    id: uid("lig"),
    name: name.trim(),
    expiresAt: expires,
    ownerId: user.id,
    members: [user.id],
    invitedEmails: [],
    code: `NB${Math.floor(1000 + Math.random() * 9000)}`,
  };
  state.leagues.push(league);
  view.selectedLeagueId = league.id;
  view.tab = "liga";
  view.leagueView = "mine";
  view.modal = null;
  await persistAndRender();
}

async function joinLeague(code) {
  const user = currentUser();
  const query = String(code || "").trim().toLowerCase();
  const league = state.leagues.find((item) => item.code.toLowerCase() === query)
    || state.leagues.find((item) => item.name.toLowerCase().includes(query));
  if (!league) return toast("Liga nao encontrada no data.json.");
  if (!league.members.includes(user.id)) league.members.push(user.id);
  view.selectedLeagueId = league.id;
  view.tab = "liga";
  view.leagueView = "mine";
  view.modal = null;
  await persistAndRender();
}

async function leaveLeague(leagueId) {
  const league = state.leagues.find((item) => item.id === leagueId);
  if (!league || !session?.userId) return toast("Liga nao encontrada.");
  if (!window.confirm(`Sair da liga "${league.name}"? Seus palpites nesta liga serao removidos.`)) return;

  league.members = league.members.filter((memberId) => memberId !== session.userId);
  state.picks = state.picks.filter((pick) => pick.leagueId !== league.id || pick.userId !== session.userId);

  if (league.members.length === 0) {
    state.leagues = state.leagues.filter((item) => item.id !== league.id);
    state.picks = state.picks.filter((pick) => pick.leagueId !== league.id);
  } else if (league.ownerId === session.userId) {
    league.ownerId = league.members[0];
  }

  view.selectedLeagueId = userLeagues()[0]?.id || null;
  view.tab = "ligas";
  view.leagueView = "mine";
  await persistAndRender();
  toast("Voce saiu da liga.");
}

function shareLeague(leagueId) {
  const league = state.leagues.find((item) => item.id === leagueId) || currentLeague();
  if (!league) return toast("Liga nao encontrada.");
  const link = `${window.location.origin || "http://168.75.77.200:4173"}?join=${encodeURIComponent(league.code)}`;
  const message = `Você foi convidado para a liga "${league.name}" do aplicativao NecroBET. Venha se divertir ou profetizar! ${link}`;
  window.location.href = `https://wa.me/?text=${encodeURIComponent(message)}`;
}

async function autoJoinFromInvite() {
  if (!view.pendingJoinCode || !session || !currentUser()) return;
  const code = view.pendingJoinCode;
  const league = state.leagues.find((item) => item.code.toLowerCase() === code.trim().toLowerCase());
  if (!league) return;
  if (!league.members.includes(session.userId)) {
    league.members.push(session.userId);
    await saveState();
  }
  view.selectedLeagueId = league.id;
  view.tab = "liga";
  view.leagueView = "mine";
  view.pendingJoinCode = "";
  const cleanUrl = `${window.location.origin}${window.location.pathname}`;
  window.history.replaceState({}, "", cleanUrl);
}

async function inviteEmail(email) {
  const league = currentLeague();
  const normalized = normalizeEmail(email);
  if (!league || !isValidEmail(normalized)) return toast("Informe um email valido.");
  const result = await apiPost("api/league/invite", { leagueId: league.id, email: normalized });
  if (!result.ok) return toast(result.error || "Nao consegui adicionar o convite.");
  state = { ...clone(seed), ...result.state };
  render();
}

async function pickContacts() {
  if (!("contacts" in navigator) || !("ContactsManager" in window)) {
    toast("Seu navegador nao liberou acesso a contatos. Use o campo manual.");
    return;
  }
  try {
    const contacts = await navigator.contacts.select(["name", "email"], { multiple: true });
    for (const contact of contacts) {
      await inviteEmail(contact.email?.[0] || "");
    }
    toast(`${contacts.length} contato(s) adicionados.`);
  } catch {
    toast("Selecao de contatos cancelada.");
  }
}

async function identifyPerson(personName) {
  const name = personName.trim();
  if (!name) return;
  const registered = state.people.find((item) => item.name.toLowerCase() === name.toLowerCase());
  if (registered && registered.type === "publica" && registered.source !== "avatar local") {
    if (personStatus(registered) === "Falecido") return toast("Somente personalidades vivas podem ser adicionadas.");
    await addPickForPerson(registered);
    return;
  }

  view.pendingPickName = name;
  view.publicFigureAnswer = "";
  view.publicFigureDetails = "";
  view.showPublicRefine = false;
  view.candidateResults = [];
  view.identifying = true;
  view.modal = { type: "identify" };
  render();

  const result = await searchPeople(name, "");
  view.candidateResults = result.candidates || [];
  view.identifying = false;
  render();
}

async function refinePublicPerson({ personScope, category }) {
  if (personScope === "private") {
    await addPrivatePick(view.pendingPickName);
    return;
  }
  const context = String(category || "").trim();
  if (!context) return toast("Selecione o que a figura publica e.");
  view.publicFigureAnswer = "yes";
  view.publicFigureDetails = context;
  view.showPublicRefine = false;
  view.candidateResults = [];
  view.identifying = true;
  render();
  const result = await searchPeople(view.pendingPickName, context);
  view.candidateResults = result.candidates || [];
  view.identifying = false;
  render();
}

async function addPickFromCandidate(candidateId) {
  const candidate = view.candidateResults.find((item) => item.id === candidateId);
  if (!candidate) return toast("Candidato nao encontrado.");
  if (candidate.status === "Falecido") return toast("Somente personalidades vivas podem ser adicionadas.");
  let registered = state.people.find((item) => item.name.toLowerCase() === candidate.name.toLowerCase());
  if (!registered) {
    registered = {
      name: candidate.name,
      type: "publica",
      image: candidate.image || initialsImage(candidate.name),
      source: candidate.source || "Wikipedia",
      classification: candidate.classification || "Pessoa publica",
      status: candidate.status || "Vivo",
      description: candidate.description || "",
      url: candidate.url || "",
    };
    state.people.push(registered);
  } else {
    registered.status = candidate.status || personStatus(registered);
    registered.classification = candidate.classification || registered.classification;
    registered.description = candidate.description || registered.description;
    registered.url = candidate.url || registered.url;
  }
  await addPickForPerson(registered);
}

async function addPrivatePick(personName) {
  const league = currentLeague();
  const name = personName.trim();
  if (!league || !name) return;

  let registered = state.people.find((item) => item.name.toLowerCase() === name.toLowerCase());
  if (!registered) {
    registered = {
      name,
      type: "privada",
      image: initialsImage(name),
      source: "avatar local",
      classification: "Contato privado",
      status: "Vivo",
    };
    state.people.push(registered);
  }
  await addPickForPerson(registered);
}

async function addPickForPerson(registered) {
  const league = currentLeague();
  if (!league || !registered) return;
  if (personStatus(registered) === "Falecido") return toast("Somente personalidades vivas podem ser adicionadas.");

  state.picks.push({
    id: uid("bet"),
    leagueId: league.id,
    userId: session.userId,
    personName: registered.name,
    createdAt: new Date().toISOString(),
  });
  view.modal = null;
  await persistAndRender();
}

async function deletePick(pickId) {
  const pick = state.picks.find((item) => item.id === pickId);
  if (!pick) return toast("Palpite nao encontrado.");
  if (pick.userId !== session?.userId) return toast("Voce so pode excluir seus proprios palpites.");

  state.picks = state.picks.filter((item) => item.id !== pickId);
  await persistAndRender();
  toast("Palpite excluido.");
}

async function searchPeople(name, context = "") {
  try {
    const params = new URLSearchParams({ name, context });
    const response = await fetch(`api/people-search?${params.toString()}`, { cache: "no-store" });
    if (!response.ok) return { candidates: [] };
    return await response.json();
  } catch {
    return { candidates: [] };
  }
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function userEmailLabel(user) {
  return user?.emailMasked || user?.email || user?.phone || "";
}

function maskEmail(email) {
  const [local, domain] = normalizeEmail(email).split("@");
  if (!local || !domain) return "";
  const visible = local.length <= 2 ? local[0] : `${local.slice(0, 2)}${"*".repeat(Math.min(local.length - 2, 6))}`;
  return `${visible}@${domain}`;
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}

async function makePasswordRecord(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return {
    passwordAlgo: "PBKDF2-SHA256",
    passwordIterations: 150000,
    passwordSalt: bytesToBase64(salt),
    passwordHash: await pbkdf2Hash(password, salt, 150000),
  };
}

async function verifyPassword(user, password) {
  if (user.passwordAlgo === "PBKDF2-SHA256" && user.passwordSalt && user.passwordHash) {
    const salt = base64ToBytes(user.passwordSalt);
    const candidate = await pbkdf2Hash(password, salt, user.passwordIterations || 150000);
    return candidate === user.passwordHash;
  }

  return user.passwordHash === legacyPasswordHash(password);
}

async function pbkdf2Hash(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(password || "")),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256
  );
  return bytesToBase64(new Uint8Array(bits));
}

function legacyPasswordHash(password) {
  let hash = 2166136261;
  const value = String(password || "");
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `local-${(hash >>> 0).toString(16)}`;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function initialsImage(name) {
  const initials = escapeHtml(
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || "")
      .join("")
  );
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
      <rect width="160" height="160" rx="18" fill="#211629"/>
      <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" fill="#e9d5ff" font-family="Arial, sans-serif" font-size="48" font-weight="800">${initials}</text>
    </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toast(message) {
  const old = document.querySelector(".toast");
  if (old) old.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}

loadState();
