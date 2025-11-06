import { createConfig, http } from 'wagmi';
import { base, baseSepolia } from 'wagmi/chains';
import { metaMask, walletConnect, coinbaseWallet } from 'wagmi/connectors';

// RPC URLs - can be overridden with environment variables
const BASE_SEPOLIA_RPC = process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC || 'https://sepolia.base.org';
const BASE_MAINNET_RPC = process.env.NEXT_PUBLIC_BASE_MAINNET_RPC || 'https://mainnet.base.org';

export const config = createConfig({
  chains: [base, baseSepolia],
  connectors: [
    metaMask(),
    walletConnect({
      projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'your-project-id',
    }),
    coinbaseWallet({
      appName: 'x402 Paywall',
    }),
  ],
  transports: {
    [base.id]: http(BASE_MAINNET_RPC),
    [baseSepolia.id]: http(BASE_SEPOLIA_RPC),
  },
});

