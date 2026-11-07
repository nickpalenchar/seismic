import { expect, test } from 'bun:test';
import { bothNames, seismicEnv } from './env';

test('the SEISMIC_ name wins, the OBEYA_ name counts where it is not set', () => {
  expect(seismicEnv('HOME', { SEISMIC_HOME: '/new', OBEYA_HOME: '/old' })).toBe('/new');
  expect(seismicEnv('HOME', { OBEYA_HOME: '/old' })).toBe('/old');
  expect(seismicEnv('HOME', {})).toBeUndefined();
  expect(seismicEnv('HOME', { SEISMIC_HOME: '', OBEYA_HOME: '/old' })).toBe('');
});

test('bothNames sets the new and the old name', () => {
  expect(bothNames({ URL: 'u' })).toEqual({ SEISMIC_URL: 'u', OBEYA_URL: 'u' });
});
