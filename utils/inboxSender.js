// Whether an inbound email may go into one of the queues (registrations@, rearrangements@)
// rather than being forwarded to the results inbox.
//
// Both queues are filled by the results secretary forwarding mail to them, so the check is
// the same: the From must be on that queue's allowlist, and SES's own verdicts must agree
// the From is genuine. **An empty allowlist closes the queue**, like every token in this
// app: mail to the address is then forwarded exactly as before, so nothing is lost and
// nothing is queued. The queues are only read by a superadmin and nothing in them is applied
// automatically, so the risk this guards is noise rather than harm — but an address anyone
// can fill is an address somebody will.

// The From header proves nothing by itself. DKIM or SPF passing is what Gmail and Outlook
// both give a real forward; a DMARC FAIL means the From was forged, whatever else passed.
function authenticated(receipt) {
  const v = k => receipt && receipt[k] && receipt[k].status
  if (v('dmarcVerdict') === 'FAIL') return false
  return v('dkimVerdict') === 'PASS' || v('spfVerdict') === 'PASS'
}

/**
 * @param {any} parsedEmail mailparser's result
 * @param {any} notification the SES notification (for `receipt`)
 * @param {string[]} allowlist the queue's *_INBOX_SENDERS
 * @param {string} listName the variable's name, for the refusal reason
 * @returns {{ ok: boolean, reason: string }}
 */
function senderAccepted(parsedEmail, notification, allowlist, listName) {
  const from = (parsedEmail.from && parsedEmail.from.value && parsedEmail.from.value[0]) || {}
  const address = String(from.address || '').toLowerCase()
  const allowed = (allowlist || []).map(s => s.toLowerCase()).filter(s => s.includes('@'))
  if (!allowed.length) return { ok: false, reason: listName + ' is unset' }
  if (!allowed.includes(address)) return { ok: false, reason: 'sender not allowed: ' + address }
  if (!authenticated(notification && notification.receipt)) {
    return { ok: false, reason: 'sender not authenticated (SPF/DKIM/DMARC)' }
  }
  return { ok: true, reason: 'accepted' }
}

/** @param {string[]} allowlist */
function isOpen(allowlist) {
  return (allowlist || []).some(s => s.includes('@'))
}

// The mail's own Message-ID, falling back to SES's, so an SNS redelivery is recognised.
function messageIdOf(parsedEmail, notification) {
  return parsedEmail.messageId || (notification && notification.mail && notification.mail.messageId) || null
}

module.exports = { senderAccepted, isOpen, messageIdOf, authenticated }
