import { createConfig, http } from 'wagmi';
import { base, baseSepolia } from 'wagmi/chains';
import { metaMask, walletConnect, coinbaseWallet } from 'wagmi/connectors';

// RPC URLs - can be overridden with environment variables
const BASE_SEPOLIA_RPC = process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC || 'https://sepolia.base.org';
const BASE_MAINNET_RPC = process.env.NEXT_PUBLIC_BASE_MAINNET_RPC || 'https://mainnet.base.org';

// Build connectors array - only include WalletConnect if project ID is valid
const connectors = [
  metaMask(),
  coinbaseWallet({
    appName: 'x402 Paywall',
  }),
];

// Only add WalletConnect if a valid project ID is provided
const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
if (walletConnectProjectId && walletConnectProjectId !== 'your-project-id') {
  connectors.push(
    walletConnect({
      projectId: walletConnectProjectId,
    })
  );
}

export const config = createConfig({
  chains: [base, baseSepolia],
  connectors,
  transports: {
    [base.id]: http(BASE_MAINNET_RPC),
    [baseSepolia.id]: http(BASE_SEPOLIA_RPC),
  },
});

