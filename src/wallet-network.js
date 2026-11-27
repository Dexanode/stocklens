export async function walletIsOnBaseSepolia(connector, provider, connectedChainId) {
  if (!provider || connectedChainId !== 84532) return false;
  const providerChain = Number(await provider.request({ method: "eth_chainId" }));
  const connectorChain = connector ? Number(await connector.getChainId()) : providerChain;
  return providerChain === 84532 && connectorChain === 84532;
}

// Check the actual provider again at the point the wallet request is made.
export function guardedWalletProvider(connector, provider, connectedChainId, account) {
  return {
    async request(payload) {
      if (payload.method === "eth_sendTransaction") {
        if (!await walletIsOnBaseSepolia(connector, provider, connectedChainId)) {
          throw Object.assign(new Error("Switch your connected wallet to Base Sepolia before recording."), { code: 4100 });
        }
        const accounts = await provider.request({ method: "eth_accounts" });
        const from = payload.params?.[0]?.from;
        if (!Array.isArray(accounts) || !from || from.toLowerCase() !== account.toLowerCase() || !accounts.some((a) => a.toLowerCase() === account.toLowerCase())) {
          throw Object.assign(new Error("Wallet account changed. Reconnect before recording."), { code: 4100 });
        }
      }
      return provider.request(payload);
    },
  };
}
