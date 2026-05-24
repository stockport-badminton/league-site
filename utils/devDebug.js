// Development debug utilities
class DevDebug {
  constructor() {
    this.logs = [];
    this.enabled = process.env.DEV_MODE === 'true' || process.env.NODE_ENV === 'development';
  }

  log(category, message, data = null) {
    if (!this.enabled) return;

    const entry = {
      timestamp: new Date().toISOString(),
      category,
      message,
      data
    };

    this.logs.push(entry);
    console.log(`[${category}]`, message, data || '');
  }

  logFormChange(fieldName, value) {
    this.log('FORM', `Field changed: ${fieldName}`, { field: fieldName, value });
  }

  logAjax(method, url, status = null, response = null) {
    this.log('AJAX', `${method} ${url}${status ? ` (${status})` : ''}`, response);
  }

  logValidation(fieldName, isValid, errors = []) {
    this.log('VALIDATION', `${fieldName}: ${isValid ? 'PASS' : 'FAIL'}`, { field: fieldName, errors });
  }

  logSubmit(formName, data) {
    this.log('SUBMIT', `${formName} submitted`, { dataKeys: Object.keys(data), dataSize: JSON.stringify(data).length });
  }

  getRecentLogs(limit = 50) {
    return this.logs.slice(-limit);
  }

  clear() {
    this.logs = [];
  }

  exportLogs() {
    return JSON.stringify(this.logs, null, 2);
  }
}

module.exports = new DevDebug();
