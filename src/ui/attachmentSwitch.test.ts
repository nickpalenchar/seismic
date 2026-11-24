import { expect, spyOn, test } from 'bun:test';
import { api } from './api';
import { attachmentSwitch } from './attachmentSwitch';
import { fileTo } from './shots';

test('a workspace switch sees pending files from lookup through inserting the final path', async () => {
  const found = Promise.withResolvers<string | null>();
  const uploaded = Promise.withResolvers<string>();
  const sending = Promise.withResolvers<void>();
  const find = spyOn(api, 'findFile').mockImplementationOnce(() => found.promise).mockResolvedValue('/project/second.txt');
  const upload = spyOn(api, 'uploadFile').mockImplementation(async () => {
    sending.resolve();
    return uploaded.promise;
  });
  const state = () => attachmentSwitch('select', 'check');
  const paths: string[] = [];
  try {
    const inserting = fileTo('attachment-test', [new File([], 'first.txt'), new File([], 'second.txt')], path => {
      expect(state()).toBe('pending');
      paths.push(path);
    });
    expect(state()).toBe('pending');
    found.resolve(null);
    await sending.promise;
    expect(state()).toBe('pending');
    uploaded.resolve('/uploads/first.txt');
    expect(await inserting).toBe(2);
    expect(paths).toEqual(['/uploads/first.txt', '/project/second.txt']);
    expect(state()).toBe('ready');
  } finally {
    found.resolve(null);
    uploaded.resolve('/uploads/first.txt');
    upload.mockRestore();
    find.mockRestore();
  }
});
