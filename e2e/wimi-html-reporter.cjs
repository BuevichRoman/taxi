const fs = require('node:fs');
const path = require('node:path');

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[ch]));

const statusLabel = (status) => ({
  passed: 'PASS',
  failed: 'FAIL',
  timedOut: 'FAIL',
  interrupted: 'BLOCKED',
  skipped: 'BLOCKED',
}[status] || 'BLOCKED');

const mimeType = (filePath) => {
  const ext = path.extname(filePath || '').toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.json') return 'application/json';
  return 'application/octet-stream';
};

const dataUri = (filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return `data:${mimeType(filePath)};base64,${fs.readFileSync(filePath).toString('base64')}`;
};

const flattenSteps = (steps, depth = 0) => steps.flatMap((step) => [
  { title: step.title, category: step.category, duration: step.duration, error: step.error?.message, depth },
  ...flattenSteps(step.steps || [], depth + 1),
]);

class WimiHtmlReporter {
  constructor(options = {}) {
    this.outputFile = options.outputFile || 'wimi-kids-report.html';
    this.results = [];
    this.startedAt = new Date();
  }

  onBegin(config, suite) {
    this.startedAt = new Date();
    this.total = suite.allTests().length;
  }

  onTestEnd(test, result) {
    const stepDetails = [];
    const attachments = (result.attachments || []).map((attachment) => {
      let buffer = null;
      if (attachment.path && fs.existsSync(attachment.path)) buffer = fs.readFileSync(attachment.path);
      else if (attachment.body) buffer = Buffer.from(attachment.body);
      if (!buffer) return null;

      if (attachment.contentType === 'application/json' && /^step-\d+-details\.json$/.test(attachment.name)) {
        try { stepDetails.push(JSON.parse(buffer.toString('utf8'))); } catch { /* keep raw attachment */ }
      }
      const contentType = attachment.contentType || mimeType(attachment.path);
      return {
        name: attachment.name,
        contentType,
        body: `data:${contentType};base64,${buffer.toString('base64')}`,
      };
    }).filter(Boolean);
    stepDetails.sort((a, b) => a.number - b.number);
    this.results.push({
      id: test.title.match(/MAN-\d{2}/)?.[0] || null,
      title: test.titlePath().slice(1).join(' › '),
      status: statusLabel(result.status),
      rawStatus: result.status,
      duration: result.duration,
      error: result.error?.message || result.errors?.map((e) => e.message).filter(Boolean).join('\n') || '',
      steps: flattenSteps(result.steps || []),
      stepDetails,
      attachments,
    });
  }

  async onEnd(result) {
    const manualCasesPath = path.join(__dirname, 'wimi-manual-cases.json');
    const manualCases = fs.existsSync(manualCasesPath) ? JSON.parse(fs.readFileSync(manualCasesPath, 'utf8')) : [];
    const manualStatus = (item) => {
      const linked = this.results.filter((test) => test.id === item.id);
      const externalStatus = item.id === 'MAN-10' &&
        ['PASS', 'FAIL', 'BLOCKED'].includes(process.env.WIMI_MAN10_STATUS)
          ? process.env.WIMI_MAN10_STATUS : null;
      if (linked.some((test) => test.status === 'FAIL') || externalStatus === 'FAIL') return 'FAIL';
      if (linked.length && linked.every((test) => test.status === 'PASS')) return 'PASS';
      return externalStatus || 'BLOCKED';
    };
    const testCounts = { PASS: 0, FAIL: 0, BLOCKED: 0 };
    for (const item of this.results) testCounts[item.status]++;
    const counts = { PASS: 0, FAIL: 0, BLOCKED: 0 };
    if (manualCases.length) {
      for (const item of manualCases) counts[manualStatus(item)]++;
    } else {
      Object.assign(counts, testCounts);
    }
    const finishedAt = new Date();
    const timezone = 'Europe/Madrid';
    const localDate = new Intl.DateTimeFormat('ru-RU', {
      dateStyle: 'medium', timeStyle: 'medium', timeZone: timezone,
    }).format(finishedAt);
    const testsHtml = this.results.map((item) => {
      const steps = item.stepDetails.length
        ? `<ol class="manual-steps">${item.stepDetails.map((step) => {
            const screenshot = item.attachments.find((a) => a.name === `step-${step.number}-screenshot.png`);
            return `<li><div><strong>${step.number}. ${escapeHtml(step.action)}</strong> <span class="badge">${escapeHtml(step.status)}</span></div>
              <div><strong>Ожидаемо:</strong> ${escapeHtml(step.expected)}</div>
              <div><strong>Фактически:</strong> ${escapeHtml(step.actual)}</div>
              <div><strong>Время шага:</strong> ${step.elapsedMs} мс · <strong>часы мока:</strong> ${escapeHtml(step.simulatedTime || 'не получены')}</div>
              ${step.error ? `<pre>${escapeHtml(step.error)}</pre>` : ''}
              ${screenshot ? `<a class="evidence" href="${screenshot.body}" target="_blank" rel="noreferrer"><img alt="Шаг ${step.number}" src="${screenshot.body}"><span>Скриншот шага ${step.number}</span></a>` : '<p class="muted">Скриншот шага не получен.</p>'}</li>`;
          }).join('')}</ol>`
        : item.steps.length
          ? `<ol class="steps">${item.steps.map((step) => `<li><span class="step-status">${step.error ? 'FAIL' : 'STEP'}</span> ${escapeHtml(step.title)} <small>${step.duration} мс</small>${step.error ? `<pre>${escapeHtml(step.error)}</pre>` : ''}</li>`).join('')}</ol>`
          : '<p class="muted">Подробные шаги Playwright в сценарии не размечены.</p>';
      const attachments = item.attachments.filter((a) => !/^step-\d+-(screenshot|details)\./.test(a.name)).map((a) => {
        if (a.contentType?.startsWith('image/')) {
          return `<a class="evidence" href="${a.body}" target="_blank" rel="noreferrer"><img alt="${escapeHtml(a.name)}" src="${a.body}"><span>${escapeHtml(a.name)}</span></a>`;
        }
        if (a.contentType?.startsWith('video/')) {
          return `<div class="evidence"><video controls preload="metadata" src="${a.body}"></video><span>${escapeHtml(a.name)}</span></div>`;
        }
        return `<p><a href="${a.body}" download="${escapeHtml(a.name)}">${escapeHtml(a.name)}</a></p>`;
      }).join('');
      return `<article class="test ${item.status.toLowerCase()}"><header><span class="badge">${item.status}</span><h2>${escapeHtml(item.title)}</h2><span class="duration">${item.duration} мс</span></header>${item.error ? `<pre class="error">${escapeHtml(item.error)}</pre>` : ''}${steps}<div class="attachments">${attachments}</div></article>`;
    }).join('');
    const coverageHtml = manualCases.length
      ? '<section class="coverage"><h2>Покрытие MAN-01…MAN-10</h2><p class="muted">PASS/FAIL выставляется только при наличии соответствующего теста MAN-XX в этом прогоне. Иначе сценарий остаётся BLOCKED с причиной.</p><table><thead><tr><th>ID / сценарий</th><th>Шаги</th><th>Статус</th><th>Ожидаемо</th><th>Фактически / блокер</th></tr></thead><tbody>' +
        manualCases.map((item) => {
          const linked = this.results.filter((test) => test.id === item.id);
          const related = (item.relatedTests || []).map((title) =>
            this.results.find((test) => test.title.includes(title))
          ).filter(Boolean);
          const status = manualStatus(item);
          const relatedSummary = related.map((test) => test.title + ': ' + test.status).join('; ');
          const actual = linked.length
            ? linked.map((test) => test.error || ('Playwright: ' + test.status)).join('\\n')
            : item.id === 'MAN-10' && process.env.WIMI_MAN10_ACTUAL
              ? process.env.WIMI_MAN10_ACTUAL
              : relatedSummary
                ? item.blocker + ' Частичные проверки в этом прогоне: ' + relatedSummary + '. Полный сценарий остаётся ' + status + '.'
                : item.blocker;
          const stepActual = status === 'BLOCKED'
            ? 'BLOCKED — ' + item.blocker
            : item.id === 'MAN-10'
              ? 'PHP regression harness: ' + status + '. Детальный вывод приведён в фактическом результате сценария.'
              : linked.map((test) => test.error || ('Playwright: ' + test.status)).join('\\n');
          const evidenceNote = item.id === 'MAN-10'
            ? 'API-проверка; скриншот не требуется.'
            : status === 'BLOCKED'
              ? 'Скриншот отсутствует: шаг не выполнялся.'
              : 'См. вложения Playwright; отдельный снимок шага не привязан.';
          const stepsHtml = '<ol class="manual-steps">' + (item.steps || []).map((step, index) =>
            '<li><div><strong>Действие:</strong> ' + escapeHtml(step.action) +
            '</div><div><strong>Ожидаемо:</strong> ' + escapeHtml(step.expected) +
            '</div><div><strong>Фактически:</strong> ' + escapeHtml(stepActual) +
            '</div><div><strong>Время:</strong> ' + (status === 'BLOCKED' ? 'не измерено — шаг не выполнялся' : 'отдельно не измерялось') +
            '</div><div><strong>Доказательство:</strong> ' + escapeHtml(evidenceNote) + '</div></li>'
          ).join('') + '</ol>';
          return '<tr><td><strong>' + escapeHtml(item.id) + '</strong><br>' + escapeHtml(item.title) +
            '</td><td>' + stepsHtml + '</td><td><span class="badge">' + status + '</span></td><td>' + escapeHtml(item.expected) +
            '</td><td>' + escapeHtml(actual) + '</td></tr>';
        }).join('') + '</tbody></table></section>'
      : '';
    const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>WIMI KIDS — отчёт E2E</title>
<style>
:root{font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#182230;background:#f4f6f9}
body{margin:0}main{max-width:1100px;margin:auto;padding:24px}
h1{margin:0 0 6px}.muted,small,.duration{color:#667085}.meta{margin:0 0 20px}
.summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:18px 0}
.metric,article{background:#fff;border:1px solid #d9dee7;border-radius:10px;padding:14px}
.metric strong{display:block;font-size:1.7rem}.metric span{color:#667085}
article{margin:12px 0}.coverage{margin:22px 0}.coverage table{width:100%;border-collapse:collapse;background:#fff;font-size:.9rem}.coverage th,.coverage td{padding:9px;border:1px solid #d9dee7;text-align:left;vertical-align:top}.coverage th{background:#e9eef5}.test header{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
h2{font-size:1.05rem;margin:0;flex:1}.badge{font-weight:800;padding:3px 8px;border-radius:5px;background:#e8edf5}
.pass .badge{background:#d8f3e3;color:#17603a}.fail .badge{background:#ffe0df;color:#992a24}.blocked .badge{background:#fff0c2;color:#7a5200}
.steps{padding-left:24px}.steps li{margin:7px 0}.manual-steps{padding-left:22px}.manual-steps li{margin:10px 0;padding:9px;border:1px solid #e2e7ef;border-radius:6px}.step-status{font-size:.75rem;font-weight:700;color:#667085;margin-right:6px}
pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#fff3f2;padding:10px;border-radius:6px}
.attachments{display:flex;flex-wrap:wrap;gap:12px}.evidence{display:block;max-width:min(100%,480px);color:inherit}
.evidence img,.evidence video{display:block;max-width:100%;max-height:380px;border:1px solid #d9dee7;border-radius:6px}
.evidence span{display:block;font-size:.85rem;margin-top:4px}
@media(max-width:620px){main{padding:12px}.summary{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style></head><body><main>
<h1>WIMI KIDS — отчёт автоматизированных проверок</h1>
<p class="meta">Прогон: ${escapeHtml(localDate)} (${timezone}) · Начало: ${escapeHtml(this.startedAt.toISOString())} · Сборка: ${escapeHtml(process.env.BUILD_VERSION || process.env.GITHUB_SHA || 'не задана')} · Playwright: ${escapeHtml(result.status || 'завершён')}</p>
<section class="summary"><div class="metric"><strong>${manualCases.length || this.results.length}</strong><span>${manualCases.length ? "сценариев MAN" : "тестов Playwright"}</span></div><div class="metric"><strong>${counts.PASS}</strong><span>PASS</span></div><div class="metric"><strong>${counts.FAIL}</strong><span>FAIL</span></div><div class="metric"><strong>${counts.BLOCKED}</strong><span>BLOCKED / пропущено</span></div></section>
<p class="muted">MAN-сценарии: ${counts.PASS} PASS, ${counts.FAIL} FAIL, ${counts.BLOCKED} BLOCKED. Playwright: ${this.results.length} тестов; ${testCounts.PASS} PASS, ${testCounts.FAIL} FAIL, ${testCounts.BLOCKED} BLOCKED. PASS означает фактически пройденную проверку. Вложения встроены в этот HTML-файл.</p>
${coverageHtml}
${testsHtml || '<p>В этом прогоне тесты не запускались.</p>'}
</main></body></html>`;
    fs.writeFileSync(path.resolve(this.outputFile), html, 'utf8');
    console.log(`WIMI KIDS HTML report: ${path.resolve(this.outputFile)}`);
  }
}

module.exports = WimiHtmlReporter;
