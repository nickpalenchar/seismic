import { expect, spyOn, test } from 'bun:test';
import { api } from './api';
import { beginSpotSend, finishWatching, take, watch } from './spot';

test('a timestamped send resumes only the demo it was written on', () => {
  const play = () => Promise.resolve();
  const video = Object.assign(new EventTarget(), { paused: true, ended: false, currentTime: 12, duration: 30, videoWidth: 0, play }) as unknown as HTMLVideoElement;
  const played = spyOn(video, 'play');
  const closeFirst = watch('card', video, [], 1);
  const first = take('card')!;
  closeFirst();
  const closeSecond = watch('card', video, [], 2);
  try {
    
    first.resume();
    expect(played).not.toHaveBeenCalled();
    take('card')!.resume();
    expect(played).toHaveBeenCalledTimes(1);
  } finally {
    closeSecond();
    played.mockRestore();
  }
});

test('ending a viewing session waits for all its timestamped sends', () => {
  const act = spyOn(api, 'act').mockResolvedValue(undefined);
  try {
    const first = beginSpotSend('card');
    const second = beginSpotSend('card');
    const other = beginSpotSend('other');
    finishWatching('card');
    first();
    expect(act).not.toHaveBeenCalled();
    second();
    expect(act).toHaveBeenCalledTimes(1);
    expect(act).toHaveBeenCalledWith('card', { action: 'release' });
    other();
    expect(act).toHaveBeenCalledTimes(1);
  } finally {
    act.mockRestore();
  }
});

test('reopening during an upload cancels the old release and allows a later release', () => {
  const act = spyOn(api, 'act').mockResolvedValue(undefined);
  const video = new EventTarget() as unknown as HTMLVideoElement;
  const done = beginSpotSend('card');
  finishWatching('card');
  const unwatch = watch('card', video, [], 1);
  try {
    done();
    expect(act).not.toHaveBeenCalled();
    finishWatching('card');
    expect(act).toHaveBeenCalledTimes(1);
    expect(act).toHaveBeenCalledWith('card', { action: 'release' });
  } finally {
    unwatch();
    act.mockRestore();
  }
});
