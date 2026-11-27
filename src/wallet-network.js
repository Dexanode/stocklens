export async function walletIsOnBaseSepolia(connector, provider, connectedChainId) {
  if (!provider || connectedChainId !== 84532) return false;
  const providerChain = Number(await provider.request({ method: "eth_chainId" }));
  const connectorChain = connector ? Number(await connector.getChainId()) : providerChain;
  return providerChain === 84532 && connectorChain === 84532;
}
