// ===== 상태 =====
let selectedFiles = [];
let lastReportData = null;

// ===== DOM =====
const apiKeyInput = document.getElementById('apiKey');
const rememberKeyEl = document.getElementById('rememberKey');
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const fileListEl = document.getElementById('fileList');
const generateBtn = document.getElementById('generateBtn');
const clearBtn = document.getElementById('clearBtn');
const statusBox = document.getElementById('statusBox');
const resultSection = document.getElementById('resultSection');
const reportRoot = document.getElementById('reportRoot');
const downloadBtn = document.getElementById('downloadBtn');

// ===== API 키 저장/복원 =====
const STORAGE_KEY = 'gsr_api_key';
(function restoreKey() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    apiKeyInput.value = saved;
    rememberKeyEl.checked = true;
  }
})();
apiKeyInput.addEventListener('input', () => {
  if (rememberKeyEl.checked) localStorage.setItem(STORAGE_KEY, apiKeyInput.value);
});
rememberKeyEl.addEventListener('change', () => {
  if (rememberKeyEl.checked) localStorage.setItem(STORAGE_KEY, apiKeyInput.value);
  else localStorage.removeItem(STORAGE_KEY);
});

// ===== 파일 업로드 =====
dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  addFiles(e.dataTransfer.files);
});
fileInput.addEventListener('change', (e) => addFiles(e.target.files));

function addFiles(fileListArg) {
  for (const f of fileListArg) selectedFiles.push(f);
  renderFileList();
}

function renderFileList() {
  fileListEl.innerHTML = '';
  selectedFiles.forEach((f, idx) => {
    const li = document.createElement('li');
    const kb = (f.size / 1024).toFixed(0);
    li.innerHTML = `<span><span class="fname">${escapeHtml(f.name)}</span><span class="fsize">${kb}KB</span></span>`;
    const btn = document.createElement('button');
    btn.textContent = '삭제';
    btn.onclick = () => { selectedFiles.splice(idx, 1); renderFileList(); };
    li.appendChild(btn);
    fileListEl.appendChild(li);
  });
  generateBtn.disabled = selectedFiles.length === 0;
}

clearBtn.addEventListener('click', () => {
  selectedFiles = [];
  fileInput.value = '';
  renderFileList();
  resultSection.hidden = true;
  hideStatus();
});

// ===== 상태 메시지 =====
function showStatus(msg, type) {
  statusBox.hidden = false;
  statusBox.textContent = msg;
  statusBox.className = 'status-box' + (type ? ' ' + type : '');
}
function hideStatus() { statusBox.hidden = true; }

// ===== 파일 -> base64 =====
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ===== 리포트 생성 =====
generateBtn.addEventListener('click', async () => {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) { showStatus('Anthropic API 키를 입력해주세요.', 'error'); return; }
  if (selectedFiles.length === 0) { showStatus('서류 파일을 먼저 업로드해주세요.', 'error'); return; }

  generateBtn.disabled = true;
  showStatus('서류를 분석하고 있습니다... (파일 수가 많으면 다소 시간이 걸릴 수 있습니다)');

  try {
    const content = [];
    for (const file of selectedFiles) {
      const base64 = await fileToBase64(file);
      if (file.type === 'application/pdf') {
        content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } });
      } else if (file.type.startsWith('image/')) {
        content.push({ type: 'image', source: { type: 'base64', media_type: file.type, data: base64 } });
      }
    }
    content.push({ type: 'text', text: '위 서류들을 검토해서 지시된 JSON 스키마로만 응답하세요.' });

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 8000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content }]
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`API 오류 (${res.status}): ${errText.slice(0, 300)}`);
    }

    const data = await res.json();
    const textBlock = (data.content || []).find(b => b.type === 'text');
    if (!textBlock) throw new Error('응답에서 텍스트를 찾을 수 없습니다.');

    const jsonStr = textBlock.text.trim().replace(/^```json\s*|^```\s*|```$/g, '');
    const report = JSON.parse(jsonStr);

    lastReportData = report;
    renderReport(report);
    resultSection.hidden = false;
    showStatus('리포트가 생성되었습니다.', 'success');
    resultSection.scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    console.error(err);
    showStatus('오류가 발생했습니다: ' + err.message, 'error');
  } finally {
    generateBtn.disabled = false;
  }
});

// ===== 렌더링 =====
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function boldify(s) {
  return escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

function renderReport(r) {
  const conclusionClass = r.conclusion === 'ok' ? 'ok' : (r.conclusion === 'fail' ? 'fail' : 'warn');
  const badgeText = (r.conclusionLabel || (r.conclusion === 'ok' ? '적합' : r.conclusion === 'fail' ? '부적합' : '보완 필요'))
    .split(' ').join('<br>');

  const statsCount = (r.stats || []).length || 3;
  const statsHtml = (r.stats || []).map(s => {
    const tone = s.tone === 'red' ? 'red' : (s.tone === 'amber' ? 'amber' : '');
    return `
      <div class="stat ${tone}">
        <div class="bar"></div>
        <div class="value">${escapeHtml(s.value)}</div>
        <div class="label">${escapeHtml(s.label)}</div>
        <div class="sub">${escapeHtml(s.sub)}</div>
      </div>`;
  }).join('');

  let fusionHtml = '';
  if (r.fusionTable && r.fusionTable.present && r.fusionTable.rows && r.fusionTable.rows.length) {
    const rows = r.fusionTable.rows.map(row => `
      <tr>
        <td>${escapeHtml(row.id)}</td>
        <td>${escapeHtml(row.datetime)}</td>
        <td>${escapeHtml(row.fitting)}</td>
        <td>${escapeHtml(row.standard)}</td>
        <td>${escapeHtml(row.measured)}</td>
        <td>${escapeHtml(row.current)}</td>
        <td>${escapeHtml(row.outputVoltage)}</td>
        <td>${escapeHtml(row.inputVoltage)}</td>
        <td><span class="${row.result === 'FC_OK' ? 'ok-pill' : 'warn-pill'}">${escapeHtml(row.result)}</span></td>
      </tr>`).join('');
    fusionHtml = `
      <table class="jobs">
        <tr><th>융착번호</th><th>융착일시</th><th>피팅류</th><th>기준(융착/냉각)</th><th>실측(융착/냉각)</th><th>최고/최저전류</th><th>출력전압</th><th>입력전압</th><th>판정</th></tr>
        ${rows}
      </table>
      ${r.fusionTable.note ? `<div class="jobs-note">※ ${escapeHtml(r.fusionTable.note)}</div>` : ''}
    `;
  }

  const okHtml = (r.okItems || []).map(it => `
    <div class="ok-item"><div class="dot">✓</div><div class="txt"><b>${escapeHtml(it.title)}</b> — <span>${escapeHtml(it.detail)}</span></div></div>
  `).join('');

  const warnHtml = (r.warnItems || []).map(it => `
    <div class="warn-item">
      <div class="row"><span class="tag ${it.tag === 'req' ? 'req' : 'rec'}">${it.tag === 'req' ? '필수' : '권고'}</span><span class="title">${escapeHtml(it.title)}</span></div>
      <div class="desc">${escapeHtml(it.detail)}</div>
    </div>
  `).join('');

  reportRoot.innerHTML = `
    <div class="sheet">
      <div class="report-header">
        <h2>${escapeHtml(r.title)}</h2>
        <div class="meta">${escapeHtml(r.meta)}</div>
        <div class="src">${escapeHtml(r.sources)}</div>
      </div>
      <div class="stats" style="grid-template-columns:repeat(${statsCount},1fr);">
        ${statsHtml}
      </div>
      ${fusionHtml}
      <div class="columns">
        <div class="rpanel">
          <div class="rpanel-head ok"><span>✓ 정합성 확인 항목</span><span>${(r.okItems || []).length}개</span></div>
          <div class="rpanel-body">${okHtml}</div>
        </div>
        <div class="rpanel">
          <div class="rpanel-head warn"><span>⚠ 확인 필요 / 보완 권고</span><span>${(r.warnItems || []).length}건</span></div>
          <div class="rpanel-body">${warnHtml}</div>
        </div>
      </div>
      <div class="rfooter">
        <div class="conclusion-badge ${conclusionClass}">${badgeText}</div>
        <div>
          <div class="label" style="margin-bottom:4px;">종합 의견</div>
          <div class="text">${boldify(r.summary)}</div>
        </div>
      </div>
    </div>
  `;
}

// ===== 다운로드 =====
downloadBtn.addEventListener('click', () => {
  if (!lastReportData) return;
  const styleTag = document.querySelector('link[href="style.css"]');
  fetch('style.css').then(r => r.text()).then(css => {
    const html = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<title>${escapeHtml(lastReportData.title)}</title>
<style>body{margin:0;background:#F4F2EC;padding:28px;}${css}</style>
</head><body>${reportRoot.innerHTML}</body></html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (lastReportData.title || 'report').replace(/[\\/:*?"<>|]/g, '_') + '.html';
    a.click();
    URL.revokeObjectURL(url);
  });
});
