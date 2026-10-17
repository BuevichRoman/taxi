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

const isLikelyBlankScreenshot = (attachment) => {
  if (!attachment?.contentType?.startsWith('image/png') || !attachment.body?.startsWith('data:image/png;base64,')) return false;
  try {
    const bytes = Buffer.from(attachment.body.slice('data:image/png;base64,'.length), 'base64');
    // The confirmed blank frames were 1280×720 PNGs of ~5.8 KB; valid captures
    // from this UI are tens of KB. Never render the known blank-frame signature.
    return bytes.length < 12 * 1024;
  } catch { return false; }
};

const mimeType = (filePath) => {
  const ext = path.extname(filePath || '').toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.json') return 'application/json';
  return 'application/octet-stream';
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
        try { stepDetails.push(JSON.parse(buffer.toString('utf8'))); } catch { /* retain attachment */ }
      }
      const contentType = attachment.contentType || mimeType(attachment.path);
      return { name: attachment.name, contentType, body: `data:${contentType};base64,${buffer.toString('base64')}` };
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
      const externalStatus = item.id === 'MAN-10' && ['PASS', 'FAIL', 'BLOCKED'].includes(process.env.WIMI_MAN10_STATUS)
        ? process.env.WIMI_MAN10_STATUS : null;
      if (linked.some((test) => test.status === 'FAIL') || externalStatus === 'FAIL') return 'FAIL';
      if (linked.length && linked.every((test) => test.status === 'PASS')) return 'PASS';
      return externalStatus || 'BLOCKED';
    };
    const testCounts = { PASS: 0, FAIL: 0, BLOCKED: 0 };
    for (const item of this.results) testCounts[item.status]++;
    const counts = { PASS: 0, FAIL: 0, BLOCKED: 0 };
    if (manualCases.length) for (const item of manualCases) counts[manualStatus(item)]++;
    else Object.assign(counts, testCounts);
    const finishedAt = new Date();
    const timezone = 'Europe/Madrid';
    const localDate = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'medium', timeZone: timezone }).format(finishedAt);

    const image = (attachment, alt, label) => attachment && !isLikelyBlankScreenshot(attachment)
      ? `<button class="image-open" type="button" data-image="${attachment.body}" data-alt="${escapeHtml(alt)}"><img alt="${escapeHtml(alt)}" src="${attachment.body}"><span>${escapeHtml(label)}</span></button>`
      : '<p class="muted screenshot-warning">Скриншот не показан: Chromium вернул чёрный или пустой кадр. Это отмечено как проблема захвата, а не как доказательство прохождения.</p>';

    const testsHtml = this.results.map((item) => {
      const steps = item.stepDetails.length
        ? `<ol class="manual-steps">${item.stepDetails.map((step) => {
            const screenshot = item.attachments.find((a) => a.name === `step-${step.number}-screenshot.png`);
            return `<li><div><strong>${step.number}. ${escapeHtml(step.action)}</strong> <span class="badge">${escapeHtml(step.status)}</span></div>
              <div><strong>Ожидаемо:</strong> ${escapeHtml(step.expected)}</div>
              <div><strong>Фактически:</strong> ${escapeHtml(step.actual)}</div>
              <div><strong>Время шага:</strong> ${step.elapsedMs} мс · <strong>часы мока:</strong> ${escapeHtml(step.simulatedTime || 'не получены')}</div>
              ${step.error ? `<pre>${escapeHtml(step.error)}</pre>` : ''}
              ${image(screenshot, `Шаг ${step.number}`, `Скриншот шага ${step.number} — нажмите для увеличения`)}</li>`;
          }).join('')}</ol>`
        : item.steps.length
          ? `<ol class="steps">${item.steps.map((step) => `<li><span class="step-status">${step.error ? 'FAIL' : 'STEP'}</span> ${escapeHtml(step.title)} <small>${step.duration} мс</small>${step.error ? `<pre>${escapeHtml(step.error)}</pre>` : ''}</li>`).join('')}</ol>`
          : '<p class="muted">Подробные шаги Playwright в сценарии не размечены.</p>';
      const attachments = item.attachments.filter((a) => !/^step-\d+-(screenshot|details)\./.test(a.name)).map((a) => {
        if (a.contentType?.startsWith('image/')) return image(a, a.name, a.name + ' — нажмите для увеличения');
        if (a.contentType?.startsWith('video/')) return `<div class="evidence"><video controls preload="metadata" src="${a.body}"></video><span>${escapeHtml(a.name)}</span></div>`;
        return `<p><a href="${a.body}" download="${escapeHtml(a.name)}">${escapeHtml(a.name)}</a></p>`;
      }).join('');
      return `<article class="test ${item.status.toLowerCase()}"><header><span class="badge">${item.status}</span><h2>${escapeHtml(item.title)}</h2><span class="duration">${item.duration} мс</span></header>${item.error ? `<pre class="error">${escapeHtml(item.error)}</pre>` : ''}${steps}<div class="attachments">${attachments}</div></article>`;
    }).join('');

    const slideItems = this.results.flatMap((item) => item.stepDetails.map((step) => {
      const relatedCases = manualCases.filter((manual) => (manual.relatedTests || []).some((title) => item.title.includes(title)));
      const manual = relatedCases[0] || manualCases.find((candidate) => candidate.id === item.id);
      return {
        item, step,
        screenshot: item.attachments.find((a) => a.name === 'step-' + step.number + '-screenshot.png' && !isLikelyBlankScreenshot(a)),
        manual,
        group: manual ? manual.id + ' — ' + manual.title : (item.id || item.title),
        groupIds: relatedCases.length ? relatedCases.map((candidate) => candidate.id) : [manual?.id || item.id || item.title],
      };
    }));
    const testGroups = [...new Map(slideItems.flatMap((entry) => entry.groupIds.map((id) => {
      const manual = manualCases.find((candidate) => candidate.id === id);
      return [id, { id, label: manual ? manual.id + ' — ' + manual.title : entry.group }];
    })).map(([id, value]) => [id, value])).values()];
    const slidesHtml = slideItems.map((entry, index) => '<article class="slide" data-slide="' + index + '" data-test-group="' + escapeHtml(entry.groupIds.join(',')) + '" hidden>' +
      '<header><strong>' + escapeHtml(entry.group) + '</strong><span>Шаг ' + entry.step.number + '</span></header>' +
      (entry.screenshot ? '<img class="slide-image" alt="Скриншот шага ' + entry.step.number + '" src="' + entry.screenshot.body + '">' : '<div class="no-image">Скриншот не получен или кадр чёрный — проверка захвата не пройдена</div>') +
      '<button class="comment-toggle" type="button" aria-expanded="false">Показать комментарий</button>' +
      '<div class="slide-comment" hidden><p><b>Тест:</b> ' + escapeHtml(entry.item.title) + '</p><p><b>Сценарий:</b> ' + escapeHtml(entry.group) + '</p><p><b>Действие:</b> ' + escapeHtml(entry.step.action) + '</p><p><b>Ожидаемо:</b> ' + escapeHtml(entry.step.expected) + '</p><p><b>Фактически:</b> ' + escapeHtml(entry.step.actual) + '</p><p><b>Статус:</b> ' + escapeHtml(entry.step.status) + ' · <b>Время:</b> ' + entry.step.elapsedMs + ' мс · <b>часы мока:</b> ' + escapeHtml(entry.step.simulatedTime || 'не получены') + '</p></div></article>').join('');
    const slideTestTable = '<section class="coverage"><h2>Тесты в этом прогоне</h2><table><thead><tr><th>Сценарий MAN</th><th>Тест Playwright</th><th>Статус</th></tr></thead><tbody>' +
      this.results.map((item) => {
        const manual = manualCases.find((candidate) => (candidate.relatedTests || []).some((title) => item.title.includes(title))) || manualCases.find((candidate) => candidate.id === item.id);
        return '<tr><td>' + escapeHtml(manual ? manual.id + ' — ' + manual.title : item.id || 'Не сопоставлен') + '</td><td>' + escapeHtml(item.title) + '</td><td>' + escapeHtml(item.status) + '</td></tr>';
      }).join('') + '</tbody></table></section>';
    const coverageHtml = manualCases.length
      ? '<section class="coverage"><h2>Покрытие MAN-01…MAN-10</h2><p class="muted">PASS/FAIL выставляется только при наличии соответствующего теста MAN-XX в этом прогоне. Иначе сценарий остаётся BLOCKED с причиной.</p><table><thead><tr><th>ID / сценарий</th><th>Шаги</th><th>Статус</th><th>Ожидаемо</th><th>Фактически / блокер</th></tr></thead><tbody>' +
        manualCases.map((item) => {
          const linked = this.results.filter((test) => test.id === item.id);
          const related = (item.relatedTests || []).map((title) => this.results.find((test) => test.title.includes(title))).filter(Boolean);
          const status = manualStatus(item);
          const relatedSummary = related.map((test) => test.title + ': ' + test.status).join('; ');
          const actual = linked.length ? linked.map((test) => test.error || ('Playwright: ' + test.status)).join('\n')
            : item.id === 'MAN-10' && process.env.WIMI_MAN10_ACTUAL ? process.env.WIMI_MAN10_ACTUAL
            : relatedSummary ? item.blocker + ' Частичные проверки в этом прогоне: ' + relatedSummary + '. Полный сценарий остаётся ' + status + '.' : item.blocker;
          const stepActual = status === 'BLOCKED' ? 'BLOCKED — ' + item.blocker
            : item.id === 'MAN-10' ? 'PHP regression harness: ' + status + '. Детальный вывод приведён в фактическом результате сценария.'
            : linked.map((test) => test.error || ('Playwright: ' + test.status)).join('\n');
          const evidenceNote = item.id === 'MAN-10' ? 'API-проверка; скриншот не требуется.'
            : status === 'BLOCKED' ? 'Скриншот отсутствует: шаг не выполнялся.' : 'См. вложения Playwright; отдельный снимок шага не привязан.';
          const stepsHtml = '<ol class="manual-steps">' + (item.steps || []).map((step) =>
            '<li><div><strong>Действие:</strong> ' + escapeHtml(step.action) + '</div><div><strong>Ожидаемо:</strong> ' + escapeHtml(step.expected) +
            '</div><div><strong>Фактически:</strong> ' + escapeHtml(stepActual) + '</div><div><strong>Время:</strong> ' +
            (status === 'BLOCKED' ? 'не измерено — шаг не выполнялся' : 'отдельно не измерялось') +
            '</div><div><strong>Доказательство:</strong> ' + escapeHtml(evidenceNote) + '</div></li>'
          ).join('') + '</ol>';
          return '<tr><td><strong>' + escapeHtml(item.id) + '</strong><br>' + escapeHtml(item.title) + '</td><td>' + stepsHtml +
            '</td><td><span class="badge">' + status + '</span></td><td>' + escapeHtml(item.expected) + '</td><td>' + escapeHtml(actual) + '</td></tr>';
        }).join('') + '</tbody></table></section>' : '';

    const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>WIMI KIDS — отчёт E2E</title>
<style>
:root{font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#182230;background:#f4f6f9}
body{margin:0}main{max-width:1100px;margin:auto;padding:24px}h1{margin:0 0 6px}.muted,small,.duration{color:#667085}.meta{margin:0 0 20px}
.summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:18px 0}.metric,article{background:#fff;border:1px solid #d9dee7;border-radius:10px;padding:14px}.metric strong{display:block;font-size:1.7rem;color:#182230}.metric span{color:#667085}
article{margin:12px 0}.coverage{margin:22px 0}.coverage table{width:100%;border-collapse:collapse;background:#fff;font-size:.9rem}.coverage th,.coverage td{padding:9px;border:1px solid #d9dee7;text-align:left;vertical-align:top}.coverage th{background:#e9eef5}
.test header{display:flex;align-items:center;gap:10px;flex-wrap:wrap}h2{font-size:1.05rem;margin:0;flex:1}.badge{font-weight:800;padding:3px 8px;border-radius:5px;background:#e8edf5}.pass .badge{background:#d8f3e3;color:#17603a}.fail .badge{background:#ffe0df;color:#992a24}.blocked .badge{background:#fff0c2;color:#7a5200}
.steps{padding-left:24px}.steps li{margin:7px 0}.manual-steps{padding-left:22px}.manual-steps li{margin:10px 0;padding:9px;border:1px solid #e2e7ef;border-radius:6px}.step-status{font-size:.75rem;font-weight:700;color:#667085;margin-right:6px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#fff3f2;padding:10px;border-radius:6px}
.slideshow{background:#172033;color:#fff;border-radius:12px;padding:12px;margin:18px 0;touch-action:pan-y}.slide-controls{display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}.slide-controls button,.comment-toggle{padding:10px 14px;border-radius:8px;border:1px solid #aaa;background:#fff;color:#172033;font:inherit}.slide-controls button{min-width:44px}.slide-controls select{min-width:0;max-width:48%;flex:1;padding:10px;border-radius:8px;font:inherit}.slide-controls select.selector-hidden{visibility:hidden;pointer-events:none}.intro-slide{color:#182230}.intro-slide .muted,.intro-slide .meta{color:#667085}.slide{border:0;background:transparent;color:#fff}.slide-image{display:block;width:100%;height:62vh;max-height:62vh;object-fit:contain;background:#fff;border-radius:6px;margin:10px 0;flex:none}.slide-comment{background:#fff;color:#182230;border-radius:8px;padding:10px;margin-top:8px}.slide-comment p{margin:6px 0}.summary-slide{display:none;background:#fff;color:#182230;border-radius:8px;padding:12px;max-height:72vh;overflow:auto;margin-top:12px}.no-image{padding:40px;text-align:center}.attachments{display:flex;flex-wrap:wrap;gap:12px}.image-open{display:block;max-width:min(100%,480px);padding:0;border:0;background:transparent;text-align:left;color:inherit;font:inherit;cursor:zoom-in}.image-open img,.evidence video{display:block;width:auto;max-width:100%;max-height:380px;border:1px solid #d9dee7;border-radius:6px;object-fit:contain;background:#fff}.image-open span{display:block;font-size:.85rem;margin-top:4px;text-decoration:underline}
#image-viewer{display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.92);padding:12px;align-items:center;justify-content:center;flex-direction:column}#image-viewer.open{display:flex}#image-viewer img{max-width:100%;max-height:88vh;object-fit:contain}#image-viewer button{color:#fff;background:#333;border:1px solid #aaa;border-radius:8px;padding:10px 16px;margin-bottom:10px;font-size:16px}
@media(max-width:620px){main{padding:12px}.summary{grid-template-columns:repeat(2,minmax(0,1fr))}.coverage{overflow-x:auto}.coverage table{min-width:680px}}
</style></head><body><main>
<section class="slideshow"><div class="slide-controls"><button id="first-slide" type="button" aria-label="К первому слайду">&lt;&lt;</button><button id="prev-slide" type="button" aria-label="Предыдущий слайд">←</button><span id="slide-counter"></span><button id="next-slide" type="button" aria-label="Следующий слайд">→</button><button id="last-slide" type="button" aria-label="К последнему слайду">&gt;&gt;</button><select id="test-selector" aria-label="Выбрать тест">${testGroups.map((group) => '<option value="' + escapeHtml(group.id) + '">' + escapeHtml(group.label) + '</option>').join('')}</select></div>
<article class="slide intro-slide" data-slide="intro" hidden>
<h1>WIMI KIDS — отчёт автоматизированных проверок</h1>
<p class="meta">Прогон: ${escapeHtml(localDate)} (${timezone}) · Начало: ${escapeHtml(this.startedAt.toISOString())} · Сборка: ${escapeHtml(process.env.BUILD_VERSION || process.env.GITHUB_SHA || 'не задана')} · Playwright: ${escapeHtml(result.status || 'завершён')}</p>
<section class="summary"><div class="metric"><strong>${manualCases.length || this.results.length}</strong><span>${manualCases.length ? "сценариев MAN" : "тестов Playwright"}</span></div><div class="metric"><strong>${counts.PASS}</strong><span>PASS</span></div><div class="metric"><strong>${counts.FAIL}</strong><span>FAIL</span></div><div class="metric"><strong>${counts.BLOCKED}</strong><span>BLOCKED / пропущено</span></div></section>
<p class="muted">MAN-сценарии: ${counts.PASS} PASS, ${counts.FAIL} FAIL, ${counts.BLOCKED} BLOCKED. Playwright: ${this.results.length} тестов; ${testCounts.PASS} PASS, ${testCounts.FAIL} FAIL, ${testCounts.BLOCKED} BLOCKED. PASS означает фактически пройденную проверку. Вложения встроены в этот HTML-файл.</p>${slideTestTable}
</article>
${slidesHtml || '<p>Нет скриншотов шагов.</p>'}<section id="summary-slide" class="summary-slide"><h2>Последний слайд — общий блок тестов</h2><p>Прокручивайте этот блок для просмотра сводки и всех тестов.</p>${testsHtml || '<p>В этом прогоне тесты не запускались.</p>'}</section></section>
</main><script>(function(){
const slides=[...document.querySelectorAll(".slide:not(.intro-slide)")],intro=document.querySelector(".intro-slide"),summary=document.getElementById("summary-slide"),counter=document.getElementById("slide-counter"),selector=document.getElementById("test-selector");
let current=null,visible=[];const swipeArea=document.querySelector(".slideshow");let touchStart=null;
function rebuild(){const chosen=selector.value;visible=slides.filter(s=>s.dataset.testGroup.split(",").includes(chosen));current=null;showIntro()}
function updateSelectorVisibility(show){selector.classList.toggle("selector-hidden",!show)}\nfunction showIntro(){intro.hidden=false;updateSelectorVisibility(true);slides.forEach(s=>s.hidden=true);summary.style.display="none";counter.textContent="Слайд 1 из "+(visible.length+2);document.getElementById("prev-slide").disabled=true;document.getElementById("first-slide").disabled=true;document.getElementById("next-slide").disabled=false;document.getElementById("last-slide").disabled=false}
function show(n){if(n<=0){showIntro();return}if(n>visible.length){intro.hidden=true;slides.forEach(s=>s.hidden=true);summary.style.display="block";updateSelectorVisibility(true);current=visible.length+1;counter.textContent="Итоги · слайд "+(visible.length+2)+" из "+(visible.length+2);document.getElementById("prev-slide").disabled=false;document.getElementById("first-slide").disabled=false;document.getElementById("next-slide").disabled=true;document.getElementById("last-slide").disabled=true;return}
intro.hidden=true;summary.style.display="none";updateSelectorVisibility(false);slides.forEach(s=>s.hidden=true);visible[n-1].hidden=false;current=n;counter.textContent="Слайд "+(n+1)+" из "+(visible.length+2);document.getElementById("prev-slide").disabled=n===1;document.getElementById("first-slide").disabled=false;document.getElementById("next-slide").disabled=false;document.getElementById("last-slide").disabled=false}
document.getElementById("prev-slide").onclick=()=>show(current===null?0:current-1);document.getElementById("next-slide").onclick=()=>show(current===null?1:current+1);document.getElementById("first-slide").onclick=showIntro;document.getElementById("last-slide").onclick=()=>show(visible.length+1);selector.addEventListener("change",rebuild);
document.addEventListener("click",e=>{const b=e.target.closest(".comment-toggle");if(!b)return;const p=b.nextElementSibling;p.hidden=!p.hidden;b.textContent=p.hidden?"Показать комментарий":"Скрыть комментарий";b.setAttribute("aria-expanded",String(!p.hidden))});
document.addEventListener("keydown",e=>{if(e.key==="ArrowRight")show(current===null?1:current+1);if(e.key==="ArrowLeft")show(current===null?0:current-1)});
swipeArea.addEventListener("touchstart",e=>{if(e.touches.length!==1)return;const t=e.touches[0];touchStart={x:t.clientX,y:t.clientY};},{passive:true});\nswipeArea.addEventListener("touchend",e=>{if(!touchStart||!e.changedTouches.length)return;const t=e.changedTouches[0],dx=t.clientX-touchStart.x,dy=t.clientY-touchStart.y;touchStart=null;if(Math.abs(dx)<55||Math.abs(dx)<Math.abs(dy)*1.35)return;if(dx<0)show(current===null?1:current+1);else show(current===null?0:current-1);},{passive:true});
rebuild()
})();</script><div id="image-viewer" role="dialog" aria-modal="true" aria-label="Скриншот"><button type="button" id="image-close">Закрыть изображение</button><img id="image-viewer-img" alt=""></div>
<script>
(function(){const viewer=document.getElementById('image-viewer');const full=document.getElementById('image-viewer-img');function close(){viewer.classList.remove('open');full.removeAttribute('src')}document.addEventListener('click',function(e){const btn=e.target.closest('button.image-open');if(btn){full.src=btn.dataset.image;full.alt=btn.dataset.alt||'Скриншот';viewer.classList.add('open')} });document.getElementById('image-close').addEventListener('click',close);viewer.addEventListener('click',function(e){if(e.target===viewer)close()});document.addEventListener('keydown',function(e){if(e.key==='Escape')close()})})();
</script></body></html>`;
    fs.writeFileSync(path.resolve(this.outputFile), html, 'utf8');
    console.log(`WIMI KIDS HTML report: ${path.resolve(this.outputFile)}`);
  }
}

module.exports = WimiHtmlReporter;
