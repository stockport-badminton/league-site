// Moved out of views/partials/debugPanel.ejs (REARCH-07 step 5), unchanged.
// Dev debug utilities
window.devLogs = [];

document.getElementById('devDebugPanel').addEventListener('click', function (event) {
  var el = event.target instanceof Element ? event.target.closest('[data-debug]') : null;
  if (!el) return;
  var action = el.getAttribute('data-debug');
  if (action === 'toggle') {
    var content = document.getElementById('devDebugContent');
    content.style.display = content.style.display === 'none' ? 'block' : 'none';
  } else if (action === 'clear') {
    clearDevLogs();
  } else if (action === 'export') {
    exportDevLogs();
  }
});

function logToPanel(category, message, data) {
  window.devLogs.push({ timestamp: new Date().toLocaleTimeString(), category, message, data });
  updateLogsList();
}

function updateLogsList() {
  const list = document.getElementById('logsList');
  const recent = window.devLogs.slice(-20);
  if (recent.length === 0) {
    list.innerHTML = '<div style="color: #858585;">No logs yet</div>';
    return;
  }
  list.innerHTML = recent.map(log =>
    `<div style="padding: 4px 0; border-bottom: 1px solid #3e3e42;">
      <span style="color: #4ec9b0;">${log.timestamp}</span>
      <span style="color: #569cd6;">[${log.category}]</span>
      ${log.message}
      ${log.data ? `<div style="color: #858585; margin-top: 2px;">${JSON.stringify(log.data).substring(0, 100)}</div>` : ''}
    </div>`
  ).join('');
}

function updateFormState() {
  const form = document.getElementById('signupForm') || document.querySelector('form');
  if (!form) return;

  const formData = {};
  const inputs = form.querySelectorAll('input, select, textarea');
  inputs.forEach(input => {
    if (input.name && input.value) {
      formData[input.name] = input.value;
    }
  });

  const stateDiv = document.getElementById('formState');
  stateDiv.textContent = JSON.stringify(formData, null, 2) || '{}';
}

function clearDevLogs() {
  window.devLogs = [];
  updateLogsList();
}

function exportDevLogs() {
  const data = JSON.stringify(window.devLogs, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dev-logs-${new Date().getTime()}.json`;
  a.click();
}

// Update form state every 500ms
setInterval(updateFormState, 500);
updateFormState();

// Hook into form changes
document.addEventListener('change', (e) => {
  if (e.target.name) {
    logToPanel('FORM', `Changed: ${e.target.name}`, { value: e.target.value });
  }
});
