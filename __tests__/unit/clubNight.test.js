const { clubNightText } = require('../../utils/clubNight');

it('blanks the placeholders clubs with no club night hold', () => {
  for (const v of ['NA', 'na', ' N/A ', 'None', '-', '', null, undefined]) {
    expect(clubNightText(v)).toBe('');
  }
});

it('keeps real text, trimmed, including text that merely starts like a placeholder', () => {
  expect(clubNightText(' Tuesday 8pm ')).toBe('Tuesday 8pm');
  expect(clubNightText('Nailsworth Mondays')).toBe('Nailsworth Mondays');
  expect(clubNightText('None in summer, Tuesday 8pm otherwise')).toBe('None in summer, Tuesday 8pm otherwise');
});
