'use strict';
/* Step 1: read the stored GitHub OAuth credential via git credential fill,
 * confirm identity, and create the repository. The token never leaves the
 * process (it is not printed, only used for API calls). */
const { spawnSync } = require('node:child_process');

function fillCred() {
  const res = spawnSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
  });
  if (res.status !== 0) return null;
  const lines = res.stdout.split('\n');
  const out = {};
  for (const l of lines) {
    const i = l.indexOf('=');
    if (i > 0) out[l.slice(0, i)] = l.slice(i + 1);
  }
  return { username: out.username, token: out.password || out.oauth_token || '' };
}

(async () => {
  const cred = fillCred();
  if (!cred || !cred.token) {
    console.log('credential fill failed - GCM has no usable GitHub credential');
    process.exit(1);
  }

  const me = await (await fetch('https://api.github.com/user', {
    headers: { Authorization: 'Bearer ' + cred.token, Accept: 'application/vnd.github+json' },
  })).json();
  if (me.login) {
    console.log('authenticated as: ' + me.login);
  } else {
    console.log('identity check failed: ' + JSON.stringify(me).slice(0, 200));
    process.exit(1);
  }

  const name = 'LeebertyGXP';
  const body = {
    name,
    description: 'LeebertyGXP - configuration-driven GxP compliance workbench (GMP/GLP/GCP/GVP/GDP/GPP): audit trail with hash chain, electronic signatures, deviation/CAPA/OOS, document control, self-inspection, production batch execution. Zero npm dependencies; native window over embedded WebView2.',
    private: false,
    has_issues: true,
    has_wiki: false,
    auto_init: false,
  };
  const r = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + cred.token,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify(body),
  });
  const repo = await r.json();
  if (r.status === 201) {
    console.log('repo created: ' + repo.html_url);
  } else if (r.status === 422) {
    console.log('repo may already exist: ' + JSON.stringify(repo.errors || repo.message).slice(0, 200));
  } else {
    console.log('repo create failed: ' + r.status + ' ' + JSON.stringify(repo).slice(0, 300));
    process.exit(1);
  }
  process.exit(0);
})();