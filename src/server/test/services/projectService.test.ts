import { expect, test } from 'bun:test';
import { NotFound } from '../../notFound';
import { ProjectService } from '../../services/projectService';
import { useChatServer } from '../helpers/chatServer';

const server = useChatServer();

const serviceOf = () => {
  const projects = [server.shop(), server.website()];
  return new ProjectService(
    (id) => projects.find((project) => project.id === id),
    () => projects,
    (chat) => (chat === 7 ? server.shop() : undefined),
  );
};

test('finds a project by its id; none sent, or an unknown one, is refused', async () => {
  const service = serviceOf();
  expect(await service.getProjectRuntime(server.shop().id)).toBe(server.shop());
  await expect(service.getProjectRuntime(null)).rejects.toBeInstanceOf(NotFound);
  await expect(service.getProjectRuntime('nope')).rejects.toBeInstanceOf(NotFound);
});

test('finds the project of a group and of a canvas; an unknown one is refused', async () => {
  const service = serviceOf();
  const canvas = server.website().board.createCanvas('Side', undefined);
  expect(await service.getProjectRuntimeForCanvas(canvas.id)).toBe(server.website());
  await expect(service.getProjectRuntimeForCanvas('nope')).rejects.toBeInstanceOf(NotFound);
  await expect(service.getProjectRuntimeForGroup('nope')).rejects.toBeInstanceOf(NotFound);
});

test('finds the project of a chat by the id a URL gives; one that is no number is refused', async () => {
  const service = serviceOf();
  expect(await service.getProjectRuntimeForChat('7')).toEqual({ project: server.shop(), chat: 7 });
  await expect(service.getProjectRuntimeForChat('8')).rejects.toBeInstanceOf(NotFound);
  await expect(service.getProjectRuntimeForChat('x')).rejects.toBeInstanceOf(NotFound);
});
