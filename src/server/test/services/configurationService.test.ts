import { expect, test } from 'bun:test';
import { NotFound } from '../../notFound';
import { ConfigurationService } from '../../services/configurationService';

test('a Seismic without a configuration of its own refuses each part of it', async () => {
  const service = new ConfigurationService(undefined, undefined, undefined);
  await expect(service.getConfig()).rejects.toBeInstanceOf(NotFound);
  await expect(service.getOwnerSettings()).rejects.toBeInstanceOf(NotFound);
  await expect(service.getAgentModels('codex')).rejects.toBeInstanceOf(NotFound);
});

test('the model catalogs are read through the function it was given', async () => {
  const service = new ConfigurationService(undefined, undefined, async (harness) => [{ model: `${harness}-1`, isDefault: true, supportedReasoningEfforts: [] }]);
  expect((await service.getAgentModels('agy')).map((info) => info.model)).toEqual(['agy-1']);
});
