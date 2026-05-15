const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const { getAllLeagueTables } = require('../models/league');

exports.resultImage = function(req, res, next) {
  const canvas = createCanvas(1080, 1350);
  const igStoryCanvas = createCanvas(1080, 1920);
  const ctx = canvas.getContext('2d');
  const igStoryCtX = igStoryCanvas.getContext('2d');

  loadImage('static/beta/images/bg/social-' + req.params.division.replace(/([\s]{1,})/g, '-') + '.png').then((image) => {
    ctx.drawImage(image, 0, 0, 1080, 1350);
    igStoryCtX.drawImage(image, 0, 0, 1080, 1920);
    ctx.font = 'bold 60px Arial';
    igStoryCtX.font = 'bold 60px Arial';
    ctx.fillStyle = 'White';
    igStoryCtX.fillStyle = 'White';
    ctx.textAlign = 'right';
    igStoryCtX.textAlign = 'right';
    var text = 'Result: ' + req.params.homeTeam + ' vs <br> ' + req.params.awayTeam + ' <br> ' + req.params.homeScore + '-' + req.params.awayScore + ' <br> #stockport #badminton #sdbl #result https://stockport-badminton.co.uk';
    var words = text.split(' ');
    var line = '';
    var y = canvas.height / 2 + canvas.width / 4;
    var x = canvas.width - 100;
    var Igy = igStoryCanvas.height / 2 + igStoryCanvas.width / 4;
    var Igx = igStoryCanvas.width - 100;
    var lineHeight = 80;
    for (var n = 0; n < words.length; n++) {
      if (line.indexOf('#') > -1 || line.indexOf('http') > -1) {
        ctx.font = 'normal 30px Arial';
        igStoryCtX.font = 'normal 30px Arial';
        lineHeight = 40;
      }
      if (words[n] == '<br>') {
        ctx.fillText(line, x, y);
        line = '';
        y += lineHeight;
        Igy += lineHeight;
      } else {
        var testLine = line + words[n] + ' ';
        var metrics = ctx.measureText(testLine);
        var testWidth = metrics.width;
        if (testWidth > 900 && n > 0) {
          ctx.fillText(line, x, y);
          igStoryCtX.fillText(line, Igx, Igy);
          line = words[n] + ' ';
          y += lineHeight;
          Igy += lineHeight;
        } else {
          line = testLine;
        }
      }
    }
    ctx.fillText(line, x, y);
    igStoryCtX.fillText(line, Igx, Igy);
    const buffer = canvas.toBuffer('image/jpeg');
    const out = fs.createWriteStream('static/beta/images/generated/' + req.params.homeTeam.replace(/([\s]{1,})/g, '-') + req.params.awayTeam.replace(/([\s]{1,})/g, '-') + '.jpg');
    const Igout = fs.createWriteStream('static/beta/images/generated/' + req.params.homeTeam.replace(/([\s]{1,})/g, '-') + req.params.awayTeam.replace(/([\s]{1,})/g, '-') + '-Ig.jpg');
    const stream = canvas.createJPEGStream();
    const Igstream = igStoryCanvas.createJPEGStream();
    stream.pipe(out);
    out.on('finish', () => console.log('The Jpg file was created.'));
    Igstream.pipe(Igout);
    Igout.on('finish', () => console.log('The Ig Jpg file was created.'));
    res.write(buffer);
    res.end();
  });
};

exports.tablesSocial = function(req, res, next) {
  const canvasWidth = 1080;
  const canvasHeight = 1080;
  const bigCanvasWidth = 1080;
  const bigCanvasHeight = 1080 * 4;
  const bigCanvas = createCanvas(bigCanvasWidth, bigCanvasHeight);
  const bigCtx = bigCanvas.getContext('2d');

  getAllLeagueTables(req.params.season, async function(err, result) {
    if (err) {
      console.log(err);
      next(err);
    } else {
      var newResultsArray = [];
      var divIds = [7, 8, 9, 10];
      for (var div of divIds) {
        var divObject = {};
        var divArray = await result.filter(row => row.division == div).map(obj => {
          return {
            divisionName: obj.divisionName,
            name: obj.name,
            points: (obj.pointsFor === null ? 0 : obj.pointsFor),
            played: obj.played,
            pointsAgainst: (obj.pointsAgainst === null ? 0 : obj.pointsAgainst),
          };
        });
        divObject[divArray[0].divisionName] = divArray;
        newResultsArray.push(divObject);
      }
      var i = 0;
      for (var division of newResultsArray) {
        for (let [key, value] of Object.entries(division)) {
          let mergedPosY = 1080 * i;
          i++;
          const canvas = createCanvas(canvasWidth, canvasHeight);
          const ctx = canvas.getContext('2d');
          loadImage('static/beta/images/bg/social.png').then(async (image) => {
            bigCtx.drawImage(image, 0, mergedPosY);
            ctx.drawImage(image, 0, 0, canvasWidth, canvasHeight);
            ctx.font = 'bold 40px Arial';
            ctx.fillStyle = '#000';
            ctx.textAlign = 'center';
            bigCtx.font = 'bold 40px Arial';
            bigCtx.fillStyle = '#000';
            bigCtx.textAlign = 'center';
            let posY = 120;
            let posX = 230;
            let teamSpace = 300;
            let numberSpace = 150;
            ctx.font = 'bold 65px Arial';
            bigCtx.font = 'bold 65px Arial';
            ctx.fillText(key, posX, posY);
            bigCtx.fillText(key, posX, posY + mergedPosY);
            posX += teamSpace;
            ctx.fillText('P', posX, posY);
            bigCtx.fillText('P', posX, posY + mergedPosY);
            posX += numberSpace;
            ctx.fillText('W', posX, posY);
            bigCtx.fillText('W', posX, posY + mergedPosY);
            posX += numberSpace;
            ctx.fillText('L', posX, posY);
            bigCtx.fillText('L', posX, posY + mergedPosY);
            posX += numberSpace;
            ctx.fillText('Avg.', posX, posY);
            bigCtx.fillText('Avg.', posX, posY + mergedPosY);
            posY += 100;
            ctx.font = '55px Arial';
            bigCtx.font = '55px Arial';
            for (var i in value) {
              posX = 230;
              var avg = (value[i].points / value[i].played).toFixed(1);
              ctx.fillText(value[i].name, posX, posY);
              bigCtx.fillText(value[i].name, posX, posY + mergedPosY);
              posX += teamSpace;
              ctx.fillText(value[i].played, posX, posY);
              bigCtx.fillText(value[i].played, posX, posY + mergedPosY);
              posX += numberSpace;
              ctx.fillText(value[i].points, posX, posY);
              bigCtx.fillText(value[i].points, posX, posY + mergedPosY);
              posX += numberSpace;
              ctx.fillText(value[i].pointsAgainst, posX, posY);
              bigCtx.fillText(value[i].pointsAgainst, posX, posY + mergedPosY);
              posX += numberSpace;
              ctx.fillText((avg >= 0 ? avg : 0), posX, posY);
              bigCtx.fillText((avg >= 0 ? avg : 0), posX, posY + mergedPosY);
              posY += 90;
            }
            const out = fs.createWriteStream('static/beta/images/generated/league-table-' + key + '.png');
            const stream = canvas.createPNGStream();
            stream.pipe(out);
            out.on('finish', () => console.log('League table image created!'));
          });
        }
      }
      const bigOut = fs.createWriteStream('static/beta/images/generated/league-table-merged.png');
      const stream = bigCanvas.createPNGStream();
      stream.pipe(bigOut);
      bigOut.on('finish', () => console.log('League table image created!'));
      res.render('beta/league-table-social', {
        static_path: '/static',
        theme: process.env.THEME || 'flatly',
        pageTitle: 'Table Social Images',
        pageDescription: 'Table Social Images',
        query: req.query,
        canonical: ('https://' + req.get('host') + req.originalUrl).replace('www.', '').replace('.com', '.co.uk').replace('-badders.herokuapp', '-badminton')
      });
    }
  });
};

exports.tournamentSocial = function(req, res, next) {
  const canvasWidth = 1080;
  const canvasHeight = 1080;

  function drawTournamentCanvas(title, lines, filename) {
    let c = createCanvas(canvasWidth, canvasHeight);
    let ctx = c.getContext('2d');
    loadImage('static/beta/images/bg/social.png').then(async (image) => {
      ctx.drawImage(image, 0, 0, canvasWidth, canvasHeight);
      ctx.font = 'bold 40px Arial';
      ctx.fillStyle = '#000';
      ctx.textAlign = 'center';
      let posY = 120;
      let posX = 540;
      ctx.font = 'bold 65px Arial';
      ctx.fillText(title, posX, posY);
      posY += 100;
      ctx.font = 'normal 40px Arial';
      ctx.fillText('LifeLeisure Bramhall Recreation', posX, posY);
      posY += 50;
      ctx.fillText('Centre, Seal Rd, Bramhall', posX, posY);
      for (var line of lines) {
        posY += line.gap || 100;
        ctx.font = line.bold ? 'bold 40px Arial' : 'normal 40px Arial';
        ctx.fillText(line.text, posX, posY);
      }
      const out = fs.createWriteStream('static/beta/images/generated/' + filename);
      const stream = c.createPNGStream();
      stream.pipe(out);
      out.on('finish', () => console.log('League table image created!'));
    });
  }

  drawTournamentCanvas('Open Tournament', [
    { text: '11th November', bold: true },
    { text: 'Mens & Womens Doubles', bold: false },
    { text: '18th November', bold: true },
    { text: 'Mens & Womens Singles', bold: false },
    { text: 'Mixed Doubles', bold: false, gap: 50 },
    { text: 'Entry form and details on the website', bold: false },
    { text: 'https://stockport-badminton.co.uk', bold: false, gap: 50 }
  ], 'open-tournament-social.png');

  drawTournamentCanvas('`B` Tournament', [
    { text: '11th November', bold: true },
    { text: 'Mens & Womens Doubles', bold: false },
    { text: '18th November', bold: true },
    { text: 'Singles', bold: false },
    { text: 'Mixed Doubles', bold: false, gap: 50 },
    { text: 'Entry form and details on the website', bold: false },
    { text: 'https://stockport-badminton.co.uk', bold: false, gap: 50 }
  ], 'B-tournament-social.png');

  drawTournamentCanvas('`C` Tournament', [
    { text: '11th November', bold: true },
    { text: 'Mens & Womens Doubles', bold: false },
    { text: '18th November', bold: true },
    { text: 'Mixed Doubles', bold: false },
    { text: 'Entry form and details on the website', bold: false },
    { text: 'https://stockport-badminton.co.uk', bold: false, gap: 50 }
  ], 'c-tournament-social.png');

  drawTournamentCanvas('Supervet Tournament', [
    { text: '11th November', bold: true },
    { text: 'Mixed Doubles', bold: false },
    { text: '18th November', bold: true },
    { text: 'Mens Doubles', bold: false },
    { text: 'Womens Doubles', bold: false, gap: 50 },
    { text: 'Entry form and details on the website', bold: false },
    { text: 'https://stockport-badminton.co.uk', bold: false, gap: 50 }
  ], 'supervet-tournament-social.png');

  res.sendStatus(200);
};

exports.handicapTournamentSocial = function(req, res, next) {
  const canvasWidth = 1080;
  const canvasHeight = 1080;
  let canvas = createCanvas(canvasWidth, canvasHeight);
  let ctx = canvas.getContext('2d');

  loadImage('static/beta/images/bg/social.png').then(async (image) => {
    ctx.drawImage(image, 0, 0, canvasWidth, canvasHeight);
    ctx.font = 'bold 40px Arial';
    ctx.fillStyle = '#000';
    ctx.textAlign = 'center';
    let posY = 120;
    let posX = 540;
    ctx.font = 'bold 65px Arial';
    ctx.fillText('Handicap Tournaments', posX, posY);
    posY += 100;
    ctx.font = 'normal 40px Arial';
    ctx.fillText('Didsbury High School', posX, posY);
    posY += 50;
    ctx.fillText('4 The Avenue, Didsbury, M20 2ET', posX, posY);
    posY += 100;
    ctx.font = 'bold 50px Arial';
    ctx.fillText('2nd March', posX, posY);
    posY += 100;
    ctx.font = 'normal 40px Arial';
    ctx.fillText('Handicap Mens & Womens Singles', posX, posY);
    posY += 50;
    ctx.fillText('Handicap Mixed Doubles', posX, posY);
    posY += 50;
    ctx.fillText('Veteran Mens & Womens Doubles', posX, posY);
    posY += 50;
    ctx.fillText('Family Mixed Doubles', posX, posY);
    posY += 100;
    ctx.font = 'bold 50px Arial';
    ctx.fillText('9th March', posX, posY);
    posY += 100;
    ctx.font = 'normal 40px Arial';
    ctx.fillText('Handicap Mens & Womens Doubles', posX, posY);
    posY += 50;
    ctx.fillText('Veteran Singles', posX, posY);
    posY += 50;
    ctx.fillText('Veteran Mixed Doubles', posX, posY);
    posY += 100;
    ctx.fillText('Entry form and details on the website', posX, posY);
    posY += 50;
    ctx.fillText('https://stockport-badminton.co.uk', posX, posY);
    const out = fs.createWriteStream('static/beta/images/generated/handicap-tournament-social.png');
    const stream = canvas.createPNGStream();
    stream.pipe(out);
    out.on('finish', () => console.log('League table image created!'));
  });
  res.sendStatus(200);
};
