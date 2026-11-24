// The offer to turn on notifications, at the top of the fixtures & results pages
// (views/notifications-banner.ejs). Rendered hidden: the browser shows it unless this
// device is already subscribed or the banner was dismissed.
const request = require('supertest');

jest.mock('../../models/fixture');
jest.mock('../../models/division');
jest.mock('../../models/players');
jest.mock('../../models/game');
jest.mock('../../models/teams');
jest.mock('../../models/club');
jest.mock('../../models/auth.js');
jest.mock('axios');

const Fixture = require('../../models/fixture');
const app = require('../../app');

beforeEach(() => {
  Fixture.getFixtureDetails.mockResolvedValue([{
    id: 7200, date: new Date('2026-10-28T00:00:00'), status: 'outstanding',
    homeTeam: 'Tatton A', awayTeam: 'Mellor B', homeScore: null, awayScore: null,
    division: 9, divisionName: 'Division 2', venueLink: 'https://maps.example/x',
  }]);
});

it.each(['/results/Division-2', '/results/All', '/results/Premier'])('%s offers notifications under its heading, with the video', async page => {
  const res = await request(app).get(page);
  expect(res.status).toBe(200);
  expect(res.text).toMatch(/<h1>[^<]*<\/h1>[\s\S]*?id="showFilter"[\s\S]*?<\/div>\s*<div class="row col-12">\s*<div class="alert alert-info[^"]*"[^>]*id="notificationsBanner" hidden/);
  expect(res.text).toContain('<a href="/notifications" class="alert-link">Turn on notifications</a>');
  expect(res.text).toMatch(/<a href="#" class="alert-link" data-notifications-video>/);
  expect(res.text).toMatch(/<video id="notificationsVideoPlayer"[^>]*src="\/static\/beta\/video\/notifications-mobile\.mp4\?v=[0-9a-f]+"/);
});
