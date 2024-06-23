import type { AwilixContainer, NameAndRegistrationPair } from 'awilix'
import { Lifetime, asClass } from 'awilix'
import '../lib/awilixManager'

export const SINGLETON_CONFIG = { lifetime: Lifetime.SINGLETON }

export type DependencyOverrides = Partial<DiConfig>
class SomeModule {}

export function registerDependencies(
  diContainer: AwilixContainer,
  dependencyOverrides: DependencyOverrides = {},
): void {
  const diConfig: DiConfig = {
    module: asClass(SomeModule, {
      ...SINGLETON_CONFIG,
      asyncInit: 'start',
      asyncDispose: 'close',
      asyncDisposePriority: 10,
      enabled: true,
    }),
  }
  diContainer.register(diConfig)

  for (const [dependencyKey, dependencyValue] of Object.entries(dependencyOverrides)) {
    diContainer.register(dependencyKey, dependencyValue)
  }
}

type DiConfig = NameAndRegistrationPair<Dependencies>

export interface Dependencies {
  module: SomeModule
}
