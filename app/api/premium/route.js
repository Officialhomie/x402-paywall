/**
 * x402 Protected API Route - /api/premium
 * 
 * This route demonstrates the x402 Payment Required standard:
 * 1. When accessed without payment, returns HTTP 402 with payment instructions
 * 2. When accessed with X-PAYMENT header, verifies payment via facilitator
 * 3. Only grants access if payment is valid
 * 
 * HOW x402 WORKS - DETAILED EXPLANATION:
 * ======================================
 * 
 * STEP 1: Client makes initial request (no payment)
 *   → Browser/frontend calls GET /api/premium
 *   → Server checks for X-PAYMENT header in request
 *   → Header is missing → Server responds with HTTP 402
 *   → 402 response body contains payment requirements:
 *     {
 *       scheme: "exact",
 *       network: "base:84532",
 *       token: "0x...USDC...",
 *       recipient: "0x...merchant...",
 *       amount: 100000  // 0.1 USDC (6 decimals)
 *     }
 * 
 * STEP 2: Client receives 402 and processes payment
 *   → Frontend detects 402 status code
 *   → Extracts payment requirements from response body
 *   → Shows payment UI to user with amount and recipient
 *   → User connects wallet and approves payment
 *   → Wallet creates USDC transfer transaction:
 *     - From: User's wallet
 *     - To: Merchant address (recipient)
 *     - Amount: 100000 (0.1 USDC)
 *     - Network: Base Sepolia (chainId 84532)
 *   → Transaction is signed and broadcast to blockchain
 *   → Transaction is confirmed on-chain
 * 
 * STEP 3: Client gets payment proof from facilitator
 *   → After payment is confirmed, client calls facilitator
 *   → Facilitator URL: https://x402.org/facilitator (testnet)
 *   → Client sends payment transaction details to facilitator
 *   → Facilitator verifies payment on blockchain:
 *     - Checks transaction exists and is confirmed
 *     - Verifies recipient matches merchant address
 *     - Verifies amount matches required amount
 *     - Verifies token is correct USDC
 *   → If valid, facilitator returns signed payment payload
 *   → Payment payload is a cryptographic proof of payment
 * 
 * STEP 4: Client retries request with payment proof
 *   → Client makes same GET /api/premium request again
 *   → This time includes X-PAYMENT header with signed payload
 *   → Server receives request with X-PAYMENT header
 *   → Server calls settlePayment() from thirdweb/x402
 *   → settlePayment() verifies and settles the payment via Thirdweb facilitator
 *   → Facilitator validates the payment payload and settles on-chain if needed
 *   → If valid → Server grants access, returns protected content
 *   → If invalid → Server returns 402 error again
 * 
 * FACILITATOR ROLE - WHY IT EXISTS:
 * ==================================
 * The facilitator is a trusted service that solves several problems:
 * 
 * 1. No Full Node Required: Server doesn't need to run blockchain node
 * 2. Fast Verification: Facilitator has optimized verification logic
 * 3. Standardized Proofs: Provides consistent payment payload format
 * 4. Multi-Network Support: Handles Base, Solana, and other networks
 * 5. Settlement: Can handle complex payment settlement logic
 * 
 * Facilitator: Thirdweb facilitator (requires THIRDWEB_SECRET_KEY and server wallet address)
 * 
 * X-PAYMENT HEADER FORMAT:
 * ========================
 * The X-PAYMENT header contains a signed payment payload (JWT-like structure)
 * that proves payment was made. It includes:
 * - Payment transaction details
 * - Cryptographic signature from facilitator
 * - Verification metadata
 * 
 * This payload is opaque to the client - they just pass it along.
 * Only the facilitator can create and verify these payloads.
 */

import { NextResponse } from 'next/server';
import { createThirdwebClient } from 'thirdweb';
import { facilitator, settlePayment } from 'thirdweb/x402';
import { base, baseSepolia } from 'thirdweb/chains';
import fs from 'fs';
import path from 'path';

// Get merchant address from environment variables
// This is where you'll receive USDC payments
const MERCHANT_ADDRESS = process.env.MERCHANT_ADDRESS || '0x0000000000000000000000000000000000000000';

// Server wallet address (funded with ETH) used by Thirdweb facilitator for settlements
// This wallet is controlled by Thirdweb and executes the settlement transactions
const SERVER_WALLET_ADDRESS = process.env.SERVER_WALLET_ADDRESS || MERCHANT_ADDRESS;

// Network configuration - can be 'base-sepolia' or 'base'
// Default to mainnet for production
const NETWORK = process.env.NEXT_PUBLIC_NETWORK || 'base';

// USDC token addresses
const USDC_ADDRESSES = {
  'base-sepolia': '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // Base Sepolia testnet USDC
  'base': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // Base mainnet USDC
  'base:84532': '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // Base Sepolia (chainId format)
  'base:8453': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // Base mainnet (chainId format)
};

const USDC_METADATA = {
  'base-sepolia': { name: 'USDC', version: '2' },
  'base': { name: 'USD Coin', version: '2' },
};

// Payment amount: 0.1 USDC = 100000 (USDC has 6 decimals)
// Can be overridden with PAYMENT_AMOUNT environment variable
const PAYMENT_AMOUNT = parseInt(process.env.PAYMENT_AMOUNT || '100000'); // Default: 0.1 USDC

const PAYMENT_DESCRIPTION = 'Access to premium video content';
const PAYMENT_MIME_TYPE = 'video/mp4';
const PAYMENT_TIMEOUT_SECONDS = 86400; // 24 hours - aligns with x402 defaults

const MAINNET_ALIASES = ['base', 'base:8453', 'eip155:8453'];

const normalizeAddress = (address) => (address || '').toLowerCase();

const resolveNetworkConfig = (networkInput = NETWORK) => {
  const normalized = (networkInput || '').toLowerCase();
  const isMainnet = MAINNET_ALIASES.includes(normalized);
  const x402Network = isMainnet ? 'base' : 'base-sepolia';
  const displayNetwork = isMainnet ? 'base:8453' : 'base:84532';
  const networkName = isMainnet ? 'Base' : 'Base Sepolia';
  const usdcAddress = USDC_ADDRESSES[isMainnet ? 'base' : 'base-sepolia'];

  return {
    isMainnet,
    x402Network,
    displayNetwork,
    networkName,
    usdcAddress,
  };
};

const buildResourceUrl = (request) => {
  if (request?.url) {
    const requestUrlObj = new URL(request.url);
    const normalizedPathname = requestUrlObj.pathname.replace(/\/$/, '');
    return `${requestUrlObj.origin}${normalizedPathname}`;
  }

  const fallbackBase = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  return `${fallbackBase.replace(/\/$/, '')}/api/premium`;
};

const buildPaymentConfig = (request) => {
  const { isMainnet, x402Network, displayNetwork, networkName, usdcAddress } = resolveNetworkConfig();
  const usdcMetadata = USDC_METADATA[x402Network] ?? { name: 'USD Coin', version: '2' };
  const resourceUrl = buildResourceUrl(request);
  const amountString = PAYMENT_AMOUNT.toString();

  const x402Requirements = {
    scheme: 'exact',
    network: x402Network,
    maxAmountRequired: amountString,
    resource: resourceUrl,
    description: PAYMENT_DESCRIPTION,
    mimeType: PAYMENT_MIME_TYPE,
    payTo: MERCHANT_ADDRESS,
    maxTimeoutSeconds: PAYMENT_TIMEOUT_SECONDS,
    asset: usdcAddress,
    extra: {
      name: usdcMetadata.name,
      version: usdcMetadata.version,
      primaryType: 'TransferWithAuthorization',
      recipientAddress: MERCHANT_ADDRESS,
    },
  };

  const payment = {
    scheme: 'exact',
    network: displayNetwork,
    networkName,
    token: usdcAddress,
    recipient: MERCHANT_ADDRESS,
    amount: amountString,
    displayAmount: `${(PAYMENT_AMOUNT / 1_000_000).toFixed(6)} USDC`,
    description: PAYMENT_DESCRIPTION,
    x402Requirements,
  };

  return {
    resourceUrl,
    network: {
      isMainnet,
      displayNetwork,
      networkName,
      x402Network,
      usdcAddress,
    },
    payment,
    x402Requirements,
  };
};

/**
 * GET /api/premium
 * 
 * This is a protected endpoint that requires payment.
 * 
 * PAYMENT VERIFICATION FLOW:
 * 1. Extract X-PAYMENT header from request
 * 2. If missing → Return 402 with payment requirements
 * 3. If present → Verify payment using facilitator
 * 4. If valid → Return protected content
 * 5. If invalid → Return 402 error
 * 
 * @param {Request} request - Next.js request object
 * @returns {NextResponse} - Either 402 (payment required) or 200 (access granted)
 */
export async function GET(request) {
  const paymentConfig = buildPaymentConfig(request);
  const { payment, x402Requirements, network } = paymentConfig;

  // STEP 1: Check for X-PAYMENT header
  // This header contains the signed payment proof from the facilitator
  const xPaymentHeader = request.headers.get('x-payment');
  
  // STEP 2: If no payment header, return 402 Payment Required
  // This tells the client what payment is needed
  if (!xPaymentHeader) {
    return NextResponse.json(
      {
        x402Version: 1,
        ...x402Requirements,
        accepts: [x402Requirements],
        payment,
      },
      { status: 402 } // HTTP 402 Payment Required
    );
  }

  // STEP 3: Payment header is present - verify and settle using Thirdweb
  try {
    console.log('=== THIRDWEB PAYMENT SETTLEMENT ===');
    console.log('Merchant Address:', MERCHANT_ADDRESS);
    console.log('Network:', network.isMainnet ? 'Base Mainnet' : 'Base Sepolia');

    // Validate Thirdweb secret key
    const thirdwebSecretKey = process.env.THIRDWEB_SECRET_KEY;
    if (!thirdwebSecretKey) {
      console.error('❌ THIRDWEB_SECRET_KEY not configured');
      return NextResponse.json(
        { error: 'Server configuration error', message: 'Payment system not configured.' },
        { status: 500 }
      );
    }

    // Create Thirdweb client
    const client = createThirdwebClient({ secretKey: thirdwebSecretKey });

    // Get vault access token for server wallet authentication
    const vaultAccessToken = process.env.THIRDWEB_VAULT_ACCESS_TOKEN;

    if (!vaultAccessToken) {
      console.error('❌ THIRDWEB_VAULT_ACCESS_TOKEN not configured');
      return NextResponse.json(
        {
          error: 'Server configuration error',
          message: 'Wallet access credentials not configured.'
        },
        { status: 500 }
      );
    }

    // Create Thirdweb facilitator with funded server wallet
    // The server wallet must have ETH for gas fees to execute settlements
    const thirdwebFacilitator = facilitator({
      client,
      serverWalletAddress: SERVER_WALLET_ADDRESS,
      vaultAccessToken: vaultAccessToken,
    });

    console.log('Facilitator configured with server wallet:', SERVER_WALLET_ADDRESS);

    // Determine chain (Base or Base Sepolia)
    const chain = network.isMainnet ? base : baseSepolia;

    // Convert price to dollar format (Thirdweb expects "$0.01" format)
    const priceInDollars = (PAYMENT_AMOUNT / 1_000_000).toFixed(2);
    const priceString = `$${priceInDollars}`;

    console.log('Settlement parameters:', {
      resourceUrl: paymentConfig.resourceUrl,
      payTo: MERCHANT_ADDRESS,
      network: chain.name,
      price: priceString,
    });

    // Use Thirdweb's settlePayment function
    let result;
    try {
      result = await settlePayment({
        resourceUrl: paymentConfig.resourceUrl,
        method: 'GET',
        paymentData: xPaymentHeader,
        payTo: MERCHANT_ADDRESS,
        network: chain,
        price: priceString,
        facilitator: thirdwebFacilitator,
        routeConfig: {
          description: PAYMENT_DESCRIPTION,
          mimeType: PAYMENT_MIME_TYPE,
          maxTimeoutSeconds: PAYMENT_TIMEOUT_SECONDS,
        },
      });
    } catch (settlementError) {
      console.error('❌ Settlement error details:', {
        message: settlementError.message,
        stack: settlementError.stack,
        name: settlementError.name,
      });
      throw settlementError; // Re-throw to be caught by outer try-catch
    }

    console.log('Settlement result status:', result.status);

    // Check if settlement was successful
    if (result.status !== 200) {
      console.error('Payment settlement failed:', result.responseBody);
      return NextResponse.json(
        result.responseBody || { error: 'Payment verification failed' },
        {
          status: result.status,
          headers: result.responseHeaders || {},
        }
      );
    }

    // Payment verified and settled successfully!
    console.log('✅ Payment verified and settled!');
    if (result.paymentReceipt) {
      console.log('Transaction:', result.paymentReceipt.transaction);
      console.log('From:', result.paymentReceipt.from);
    }

    // STEP 5: Payment is valid! Grant access to protected content
    // At this point, we know:
    // - Payment was made on-chain
    // - Payment matches our requirements
    // - Payment proof is valid and verified by facilitator
    // 
    // Now we can safely return the protected video resource
    const videoRelativePath = process.env.VIDEO_PATH || path.join('resources ', 'ssstik.io_@wilcoxxspace_1761512614937.mp4');
    
    try {
      // Get the absolute path to the video file
      const videoAbsolutePath = path.isAbsolute(videoRelativePath) 
        ? videoRelativePath 
        : path.join(process.cwd(), videoRelativePath);
      
      // Check if file exists
      if (!fs.existsSync(videoAbsolutePath)) {
        console.error('Video file not found at:', videoAbsolutePath);
        return NextResponse.json(
          {
            error: 'Video file not found',
            message: 'The protected video resource is not available.',
          },
          { status: 500 }
        );
      }
      
      // Read the video file
      const videoBuffer = fs.readFileSync(videoAbsolutePath);
      const videoStats = fs.statSync(videoAbsolutePath);
      
      // Return the video file with proper headers
      return new NextResponse(videoBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': videoStats.size.toString(),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'private, no-cache',
          'X-Payment-Verified': 'true',
          'X-Payment-Network': network.x402Network,
        },
      });
    } catch (fileError) {
      console.error('Error serving video file:', fileError);
      // No fallback - this is a production error
      return NextResponse.json(
        {
          error: 'Video file error',
          message: 'Payment verified but video file could not be served.',
          details: fileError.message,
        },
        { status: 500 }
      );
    }

  } catch (error) {
    // Error during payment verification
    // This could be:
    // - Network error connecting to facilitator
    // - Invalid payment payload format
    // - Facilitator service unavailable
    console.error('Payment verification error:', error);
    
    return NextResponse.json(
      {
        error: 'Payment verification error',
        message: error.message || 'Failed to verify payment. Please try again.',
        hint: 'The facilitator service may be temporarily unavailable.',
        accepts: [x402Requirements],
      },
      { status: 402 }
    );
  }
}

