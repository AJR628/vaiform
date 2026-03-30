export function getSignaledProviders(providers = []) {
  return providers.filter((provider) => provider?.pressureState && provider.pressureState !== 'healthy');
}
