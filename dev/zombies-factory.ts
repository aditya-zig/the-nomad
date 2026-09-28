import { createZombieFactory } from '../src/enemies/zombieRig';

export function createFactoryForHarness(): ReturnType<typeof createZombieFactory> {
  return createZombieFactory();
}
