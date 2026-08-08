# NecroBET

PWA mobile-first para validar localmente a experiencia do produto antes de plugar backend e deploy em OCI.
Nesta versao, os dados compartilhados ficam em `data.json`, gravados pelo servidor local `serve.ps1`.
O arquivo `data.json` local nao deve ser versionado porque pode conter usuarios, hashes e ligas reais; use `data.example.json` como referencia limpa.

## Rodar localmente

```powershell
cd C:\Users\tbeni\OneDrive\Documentos\Git\Pessoal\NecroBET
powershell -ExecutionPolicy Bypass -File .\serve.ps1
```

Depois acesse:

```text
http://127.0.0.1:4173
```

## Email de cadastro

Ao concluir um cadastro, o backend tenta enviar um email de confirmacao. Configure SMTP por variaveis de ambiente:

```text
NECROBET_APP_URL=http://147.15.97.110:4173
NECROBET_SMTP_HOST=smtp.seu-provedor.com
NECROBET_SMTP_PORT=587
NECROBET_SMTP_USER=usuario-smtp
NECROBET_SMTP_PASSWORD=senha-smtp
NECROBET_EMAIL_FROM=NecroBET <no-reply@seudominio.com>
NECROBET_SMTP_TLS=starttls
```

Valores aceitos para `NECROBET_SMTP_TLS`: `starttls`, `ssl` ou `none`.
Sem SMTP configurado, o cadastro continua funcionando e a mensagem fica registrada em `email-outbox.json` para validacao local.

## Fluxos da versao inicial

- Login por email e senha.
- Email de confirmacao enviado ao concluir cadastro, quando SMTP estiver configurado.
- Recuperacao local de senha pelo fluxo "Esqueci minha senha".
- Novos usuarios armazenam `emailHash`, `emailMasked` e senha com PBKDF2-SHA256 + salt no `data.json`.
- Criacao e acesso a ligas por codigo.
- Convite por email e tentativa de uso da Contact Picker API quando o navegador permitir.
- Navegacao dentro de cada liga para registrar palpites especificos daquela liga.
- Palpites por liga com autocomplete de pessoas ja cadastradas no `data.json`.
- Identificacao de pessoa publica via candidatos da Wikipedia antes de salvar o palpite.
- Classificacao automatica inicial: Musica, Politica, Cinema/TV, Esporte, Negocios, Midia/Literatura, Ciencia ou Pessoa publica.
- Busca automatica de foto publica apos o usuario confirmar o candidato correto.
- PWA instalavel no iOS/Android pelo navegador.

## Proximos passos para backend

- Trocar a recuperacao local por envio real de email com codigo ou link seguro.
- Salvar senhas com hash forte no backend e mover a recuperacao para token/link de uso unico.
- Criar API de usuarios, ligas, convites, pessoas e palpites.
- Baixar e salvar imagens publicas em object storage, em vez de guardar apenas a URL da origem.
- Compartilhar codigos/links de liga entre dispositivos.
- Adicionar regras de privacidade, moderacao e consentimento para contatos privados.
- Opcional: adicionar um LLM gratuito/baixo custo como camada posterior para transformar apelidos e contexto em consultas melhores.
