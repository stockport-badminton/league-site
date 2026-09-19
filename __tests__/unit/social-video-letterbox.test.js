// The weekly video's slides must be letterboxed, not squashed.
//
// One `convert` invocation carried two faults, and **they hid each other** — which is why
// this is a test and not a comment. Both were measured against the live output on
// 19 Sep 2026, the first time the feature had ever been run to completion.
//
//   -resize 1920:1080   A colon is an ASPECT RATIO in ImageMagick geometry, not a size, so
//                       this forced the image to 16:9 by distorting it. A 1080x1350 result
//                       card came out 1080x608 with every word visibly stretched — a third
//                       of the intended pixels, at the wrong shape.
//
//   -extent before      `-gravity` and `-background` only affect operators AFTER them.
//   -gravity/-background Written in this order they applied to nothing, so the padding used
//                       ImageMagick's defaults: NorthWest, and WHITE.
//
// The second was invisible because of the first: `-resize` with a ratio had already forced
// the exact target aspect, leaving `-extent` nothing to pad. **Correct the colon on its own
// and the card lands top-left against white bars** — worse than what shipped. That is the
// property this file exists to hold.
//
// The 1:1 output looked fine throughout, by coincidence: ratio 1:1 of a 1080-wide image is
// 1080x1080, exactly the size intended. Only 16:9 showed the damage.

process.env.NODE_ENV = 'test';

const { letterboxArgs } = require('../../controllers/socialVideoController');

describe('letterboxArgs', () => {
  const args = letterboxArgs('slide.jpg', 'out.jpg', '1920x1080');
  const at = flag => args.indexOf(flag);

  it('fits inside the frame rather than forcing the aspect', () => {
    // `WxH` fits and preserves; `W:H` is a ratio and distorts. The separator is the bug.
    expect(args[at('-resize') + 1]).toBe('1920x1080');
    expect(args.join(' ')).not.toMatch(/\d+:\d+/);
  });

  it('sets the pad colour and alignment BEFORE extending', () => {
    expect(at('-background')).toBeLessThan(at('-extent'));
    expect(at('-gravity')).toBeLessThan(at('-extent'));
  });

  it('pads black and centres, not white and top-left', () => {
    expect(args[at('-background') + 1]).toBe('black');
    expect(args[at('-gravity') + 1]).toBe('center');
  });

  it('extends to the same frame it resized into', () => {
    expect(args[at('-extent') + 1]).toBe(args[at('-resize') + 1]);
  });

  it('reads source first and destination last, as convert requires', () => {
    expect(args[0]).toBe('slide.jpg');
    expect(args[args.length - 1]).toBe('out.jpg');
  });

  // The square case is the one that always looked right, so it is the one most likely to
  // be used as evidence that nothing is wrong. Pin it too.
  it('applies the same treatment to the square frame', () => {
    const square = letterboxArgs('a.jpg', 'b.jpg', '1080x1080');
    expect(square[square.indexOf('-resize') + 1]).toBe('1080x1080');
    expect(square.indexOf('-background')).toBeLessThan(square.indexOf('-extent'));
  });
});
