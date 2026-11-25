import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Fail, findSdk, inputTextArg, pageOnScreen, parseArgs, sdkCandidates, shq, textRuns, toDevice } from './android-phone';

test('parses each command with its options', () => {
  expect(parseArgs(['start'])).toEqual({ cmd: 'start', avd: undefined, serial: undefined, window: false, timeout: 300 });
  expect(parseArgs(['start', '--avd', 'Pixel', '--window', '--timeout', '90'])).toEqual({ cmd: 'start', avd: 'Pixel', serial: undefined, window: true, timeout: 90 });
  expect(parseArgs(['open', 'http://127.0.0.1:4480/?login=x'])).toEqual({ cmd: 'open', url: 'http://127.0.0.1:4480/?login=x', timeout: 60 });
  expect(parseArgs(['eval', 'visualViewport.height', '--timeout', '5'])).toEqual({ cmd: 'eval', js: 'visualViewport.height', timeout: 5 });
  expect(parseArgs(['tap', '#ph-talk textarea'])).toEqual({ cmd: 'tap', selector: '#ph-talk textarea', timeout: 30 });
  expect(parseArgs(['type', '--', '--not an option'])).toEqual({ cmd: 'type', text: '--not an option' });
  expect(parseArgs(['rotate', 'landscape'])).toEqual({ cmd: 'rotate', to: 'landscape' });
  expect(parseArgs(['screenshot', 'a.png'])).toEqual({ cmd: 'screenshot', file: 'a.png' });
  expect(parseArgs(['record', 'start'])).toEqual({ cmd: 'record', action: 'start', file: undefined });
  expect(parseArgs(['record', 'stop', 'b.mp4'])).toEqual({ cmd: 'record', action: 'stop', file: 'b.mp4' });
  expect(parseArgs(['stop'])).toEqual({ cmd: 'stop' });
});

test('says what is wrong with a command line', () => {
  const fails = (argv: string[], msg: RegExp) => {
    expect(() => parseArgs(argv)).toThrow(Fail);
    expect(() => parseArgs(argv)).toThrow(msg);
  };
  fails([], /usage/);
  fails(['reboot'], /unknown command reboot/);
  fails(['open'], /needs a URL/);
  fails(['open', 'localhost:4480'], /http\(s\) URL/);
  fails(['rotate', 'upside-down'], /portrait or landscape/);
  fails(['tap', '#a', '#b'], /CSS selector, as one argument/);
  fails(['start', '--timeout', 'soon'], /seconds/);
  fails(['open', 'http://localhost/', '--timeout', 'Infinity'], /seconds/);
  fails(['start', '--avd'], /needs a value/);
  fails(['start', '--avd', 'a', '--serial', 'b'], /not both/);
  fails(['eval', '1', '--window'], /takes no --window/);
  fails(['start', '--wait'], /unknown option --wait/);
  fails(['record', 'pause'], /start or stop/);
});

test('turns an element centre in CSS pixels into the device pixels under it', () => {
  const page = { left: 0, top: 210, right: 1080, bottom: 2339 }; 
  const vv = { left: 0, top: 0, height: 811, scale: 1 };
  expect(toDevice({ x: 206, y: 400, dpr: 2.625, vv }, page)).toEqual({ x: 541, y: 1260 });
  
  expect(toDevice({ x: 10, y: 10, dpr: 2.625, vv }, { left: 0, top: 0, right: 2400, bottom: 1080 })).toEqual({ x: 26, y: 26 });
  
  expect(toDevice({ x: 100, y: 300, dpr: 2, vv: { left: 100, top: 250, height: 200, scale: 2 } }, page)).toEqual({ x: 0, y: 410 });
});

test('finds the page on the screen in a view hierarchy', () => {
  const p = { x: 0, y: 0, dpr: 2.625, vv: { left: 0, top: 0, height: 498.29, scale: 1 } }; 
  const chrome = (inner: string) => `<?xml version='1.0' ?><hierarchy rotation="0">
    <node index="0" class="android.widget.FrameLayout" package="com.android.chrome" bounds="[0,0][1080,2400]">
      <node index="0" resource-id="com.android.chrome:id/compositor_view_holder" class="android.widget.FrameLayout" package="com.android.chrome" bounds="[0,63][1080,1517]">
        ${inner}
      </node>
      <node index="1" resource-id="com.android.chrome:id/toolbar" class="android.widget.FrameLayout" bounds="[0,63][1080,210]" />
    </node></hierarchy>UI hierchary dumped to: /dev/tty`;
  const webView = `<node index="0" class="android.webkit.WebView" package="com.android.chrome" bounds="[0,210][1080,1518]">
      <node index="0" class="android.webkit.WebView" package="com.android.chrome" bounds="[40,600][400,900]" />
    </node>`;
  expect(pageOnScreen(chrome(webView), p)).toEqual({ left: 0, top: 210, right: 1080, bottom: 1518 });
  
  expect(pageOnScreen(chrome(''), p)).toEqual({ left: 0, top: 209, right: 1080, bottom: 1517 });
  expect(pageOnScreen('<hierarchy><node class="android.widget.FrameLayout" bounds="[0,0][1080,2400]" /></hierarchy>', p)).toBeUndefined();
});

test('types ASCII as keys, newlines as Enter and the rest inserted', () => {
  expect(textRuns('Grüße an alle\nOK')).toEqual([{ keys: 'Gr' }, { insert: 'üß' }, { keys: 'e an alle' }, { enter: true }, { keys: 'OK' }]);
  expect(textRuns('50%sicher')).toEqual([{ keys: '50' }, { insert: '%' }, { keys: 'sicher' }]);
  expect(inputTextArg("it's done")).toBe(`'it'\\''s%sdone'`);
  expect(shq('a&b; c')).toBe(`'a&b; c'`);
});

test('looks for the SDK where the environment and Android Studio put it', () => {
  expect(sdkCandidates({ ANDROID_HOME: '/sdk' }, 'darwin', '/Users/me')).toEqual(['/sdk', join('/Users/me', 'Library', 'Android', 'sdk')]);
  expect(sdkCandidates({ ANDROID_SDK_ROOT: '/r' }, 'linux', '/home/me')).toEqual(['/r', join('/home/me', 'Android', 'Sdk')]);
  expect(sdkCandidates({ LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' }, 'win32', 'C:\\Users\\me')).toEqual([join('C:\\Users\\me\\AppData\\Local', 'Android', 'Sdk')]);
});

test('without an SDK, start fails naming what is missing', () => {
  const home = mkdtempSync(join(tmpdir(), 'android-phone-'));
  expect(() => findSdk({}, 'linux', home)).toThrow(/no Android SDK: set ANDROID_HOME/);
  const r = Bun.spawnSync(['bun', join(import.meta.dir, 'android-phone.ts'), 'start'], {
    env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, LOCALAPPDATA: join(home, 'AppData', 'Local') },
  });
  expect(r.exitCode).toBe(1);
  expect(r.stderr.toString()).toContain('android-phone: no Android SDK: set ANDROID_HOME to one');
});
