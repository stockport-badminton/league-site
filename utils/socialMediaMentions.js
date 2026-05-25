/**
 * Format social media mentions for Instagram and Facebook comments
 * Handles both Facebook page IDs and page names
 */

/**
 * Format Instagram mention text
 * @param {Array} clubs - Array of club objects with { name, instagram }
 * @returns {string} Instagram mention text like "@club1 @club2"
 */
function formatInstagramMentions(clubs) {
  if (!clubs || clubs.length === 0) return '';

  return clubs
    .filter(club => club.instagram)
    .map(club => `@${club.instagram}`)
    .join(' ');
}

/**
 * Format Facebook mention text
 * Uses the actual Facebook handles/IDs from the database
 * @param {Array} clubs - Array of club objects with { name, facebook }
 * @returns {string} Facebook mention text like "handle1, handle2, 123456789"
 */
function formatFacebookMentions(clubs) {
  if (!clubs || clubs.length === 0) return '';

  return clubs
    .filter(club => club.facebook)
    .map(club => club.facebook)
    .join(', ');
}

/**
 * Build Instagram comment text with mentions
 * @param {Array} clubs - Array of club objects with social handles
 * @param {string} baseText - Optional base text (defaults to generic message)
 * @returns {string} Complete comment text ready for posting
 */
function buildInstagramComment(clubs, baseText = 'Great matches this week! 🏸') {
  const mentions = formatInstagramMentions(clubs);
  if (!mentions) return baseText;
  return `${mentions}\n${baseText}`;
}

/**
 * Build Facebook comment text with mentions
 * @param {Array} clubs - Array of club objects with social handles
 * @param {string} baseText - Optional base text (defaults to generic message)
 * @returns {string} Complete comment text ready for posting
 */
function buildFacebookComment(clubs, baseText = 'Great matches this week! 🏸') {
  const mentions = formatFacebookMentions(clubs);
  if (!mentions) return baseText;
  return `${mentions}\n${baseText}`;
}

/**
 * Format mentions for both platforms
 * @param {Array} clubs - Array of club objects with { name, facebook, instagram }
 * @returns {Object} { instagram: string, facebook: string }
 */
function formatMentionsForPlatforms(clubs) {
  return {
    instagram: buildInstagramComment(clubs),
    facebook: buildFacebookComment(clubs),
  };
}

module.exports = {
  formatInstagramMentions,
  formatFacebookMentions,
  buildInstagramComment,
  buildFacebookComment,
  formatMentionsForPlatforms,
};
