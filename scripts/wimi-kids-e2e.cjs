const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = process.cwd();
const candidates = process.env.WIMI_MULTIBOT_PATH
  ? [path.resolve(process.env.WIMI_MULTIBOT_PATH)]
  : [path.resolve(repoRoot, '..', 'MultiBot'), path.resolve(repoRoot, 'MultiBot')];
const multibotRoot = candidates.find((candidate) =>
  fs.existsSync(path.join(candidate, 'server', 'tests', 'nanny_pricing_test.php')));
let man10Status = 'BLOCKED';
let man10Actual = '';

if (!multibotRoot) {
  man10Actual = 'MultiBot не найден. Задайте WIMI_MULTIBOT_PATH или разместите репозитории рядом; MAN-10 не запускался.';
} else {
  const serverPath = path.join(multibotRoot, 'server');
  const docker = spawnSync('docker', [
    'run', '--rm', '-v', serverPath + ':/s', '-w', '/s',
    'php:5.6-cli', 'php', 'tests/nanny_pricing_test.php',
  ], { encoding: 'utf8' });

  man10Actual = [docker.stdout, docker.stderr].filter(Boolean).join('\n').trim();
  const dockerUnavailable = /Cannot connect to the Docker daemon|error during connect|docker: command not found|pull access denied|manifest unknown|dial tcp|network is unreachable|no such host/i.test(man10Actual);
  if (docker.error) {
    man10Actual = 'Не удалось запустить Docker: ' + docker.error.message;
  } else if (dockerUnavailable) {
    man10Status = 'BLOCKED';
    man10Actual = 'Среда Docker недоступна; PHP-тест не запускался или образ не удалось получить.\n' + man10Actual;
  } else if (docker.status === 0) {
    man10Status = 'PASS';
  } else {
    man10Status = 'FAIL';
    man10Actual = 'PHP regression harness завершился с кодом ' + docker.status + '\n' + man10Actual;
  }
}

// Persist the external PHP result for the HTML reporter. This avoids relying on
// environment propagation through npm/run-script-os child processes.
fs.writeFileSync(
  path.join(repoRoot, 'e2e', 'wimi-man10-result.json'),
  JSON.stringify({ status: man10Status, actual: man10Actual }, null, 2) + '\n',
);

console.log('MAN-10:', man10Status);
if (man10Actual) console.log(man10Actual);

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const web = spawnSync(npm, ['run', 'e2e:web', ...(process.argv.slice(2).length ? ['--', ...process.argv.slice(2)] : [])], {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    WIMI_MAN10_STATUS: man10Status,
    WIMI_MAN10_ACTUAL: man10Actual,
  },
});
if (web.error) {
  console.error('Не удалось запустить браузерные тесты:', web.error.message);
  process.exit(1);
}
process.exit(web.status === null ? 1 : web.status);
