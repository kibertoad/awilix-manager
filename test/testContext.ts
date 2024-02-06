import type { AwilixContainer } from 'awilix'
import { Lifetime, asClass } from 'awilix'
import type { Resolver } from 'awilix/lib/resolvers'

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

type DiConfig = Record<keyof Dependencies, Resolver<any>>

export interface Dependencies {
  module: SomeModule
}
