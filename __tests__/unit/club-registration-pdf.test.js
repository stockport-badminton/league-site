// The prefilled club registration form fills a PDF whose fields use a standard
// font, and pdf-lib throws on any character that font's WinAnsi encoding lacks.
// Sentry NODE-1A was Cheadle Hulme's form failing on U+202D, the invisible
// left-to-right override that a phone number copied from a phone or Outlook carries.

const { PDFDocument } = require('pdf-lib');

jest.mock('../../models/club');
jest.mock('../../models/season', () => ({ current: () => '202627' }));
jest.mock('../../middleware/requireClubAccess', () => ({ assertClubAccess: () => {} }));

const Club = require('../../models/club');
const documents = require('../../controllers/documentsController');

function registration(overrides = {}) {
  return {
    core: Object.assign({
      clubName: 'Cheadle Hulme', venueName: 'Hall', venueAddress: '1 Road, Cheadle',
      clubEmail: 'club@example.com', clubWebsite: '', clubSecName: 'Sam Sec',
      clubSecEmail: 'sec@example.com', clubSecTel: '07700 900000',
      matchSecName: 'Max Match', matchSecTel: '', matchSecEmail: '',
      matchNightText: 'Tuesday 7:30pm, 3 courts', clubNightText: '', clubNight: '',
    }, overrides),
    teams: [{ teamName: 'Cheadle Hulme A', captainName: 'Zoë Cap', captainEmail: '', captainTel: '' }],
  };
}

async function render(data) {
  Club.getClubRegistration.mockResolvedValue(data);
  const res = { setHeader: jest.fn(), send: jest.fn() };
  const next = jest.fn();
  await documents.clubRegistrationFormPrefilled({ params: { club: 'Cheadle Hulme' } }, res, next);
  expect(next).not.toHaveBeenCalled();
  return (await PDFDocument.load(res.send.mock.calls[0][0])).getForm();
}

it('fills a phone number carrying invisible bidi marks, minus the marks', async () => {
  const form = await render(registration({ clubSecTel: '\u202D07700 900123\u202C' }));
  expect(form.getTextField('Secretary Phone No').getText()).toBe('07700 900123');
});

it('keeps characters the font has, and folds accents it lacks to the base letter', async () => {
  const form = await render(registration({ clubSecName: 'Zoë Mihăilă' }));
  expect(form.getTextField('Secretary').getText()).toBe('Zoë Mihaila');
});
