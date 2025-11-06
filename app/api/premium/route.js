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
import { facilitator, settlePayment } from 'thirdweb/x402';
import { createThirdwebClient } from 'thirdweb';
import { base, baseSepolia } from 'thirdweb/chains';
import fs from 'fs';
import path from 'path';

// Get merchant address from environment variables
// This is where you'll receive USDC payments
const MERCHANT_ADDRESS = process.env.MERCHANT_ADDRESS || '0x0000000000000000000000000000000000000000';

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

// Default to testnet USDC
const USDC_ADDRESS = USDC_ADDRESSES[NETWORK] || USDC_ADDRESSES['base-sepolia'];

// Payment amount: 0.1 USDC = 100000 (USDC has 6 decimals)
// Can be overridden with PAYMENT_AMOUNT environment variable
const PAYMENT_AMOUNT = parseInt(process.env.PAYMENT_AMOUNT || '100000'); // Default: 0.1 USDC

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
  // STEP 1: Check for X-PAYMENT header
  // This header contains the signed payment proof from the facilitator
  const xPaymentHeader = request.headers.get('x-payment');
  
  // STEP 2: If no payment header, return 402 Payment Required
  // This tells the client what payment is needed
  if (!xPaymentHeader) {
    // Determine network from environment or default to testnet
    const isMainnet = NETWORK === 'base' || NETWORK === 'base:8453';
    const networkChainId = isMainnet ? 'base:8453' : 'base:84532';
    const networkName = isMainnet ? 'Base' : 'Base Sepolia';
    const usdcAddress = isMainnet ? USDC_ADDRESSES['base'] : USDC_ADDRESSES['base-sepolia'];
    
    // Build payment requirements object
    // Include both simplified format for display AND full x402 format for payment creation
    // CRITICAL: Thirdweb facilitator expects network in EIP-155 format: "eip155:8453" or "eip155:84532"
    const networkNameForX402 = isMainnet ? 'eip155:8453' : 'eip155:84532';
    
    // CRITICAL: Use the request URL to construct resource URL to ensure exact match
    // This ensures the resource URL in x402Requirements matches what we'll use for verification
    let resourceUrl;
    if (request.url) {
      // Parse the request URL and use it directly
      const requestUrlObj = new URL(request.url);
      resourceUrl = `${requestUrlObj.origin}${requestUrlObj.pathname}`;
    } else {
      // Fallback to environment variable or default
      resourceUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/premium`;
    }
    
    // Remove trailing slash if present to ensure exact match
    resourceUrl = resourceUrl.replace(/\/$/, '');
    
    const paymentRequirement = {
      // Simplified fields for display (backwards compatibility)
      scheme: 'exact',
      network: networkChainId, // Network: base (8453) or base-sepolia (84532)
      token: usdcAddress, // USDC token contract address
      recipient: MERCHANT_ADDRESS, // Your wallet address to receive payments
      amount: PAYMENT_AMOUNT.toString(), // Amount in smallest unit (6 decimals for USDC)
      displayAmount: `${(PAYMENT_AMOUNT / 1000000).toFixed(6)} USDC`,
      networkName: networkName,
      description: 'Access to premium video content',
      
      // Full x402 payment requirements (for createPaymentHeader)
      // CRITICAL: Use EIP-155 network format for Thirdweb facilitator compatibility
      x402Requirements: {
        scheme: 'exact',
        network: networkNameForX402, // Thirdweb expects "eip155:8453" or "eip155:84532"
        maxAmountRequired: PAYMENT_AMOUNT.toString(),
        resource: resourceUrl,
        description: 'Access to premium video content',
        mimeType: 'video/mp4',
        payTo: MERCHANT_ADDRESS,
        maxTimeoutSeconds: 86400, // 24 hours - must match Thirdweb facilitator default
        asset: usdcAddress,
      }
    };

    // Return HTTP 402 Payment Required
    // Status code 402 is the standard for payment-required responses
    // The client should parse this and show payment UI
    return NextResponse.json(
      {
        message: 'Payment required to access this resource.',
        payment: paymentRequirement,
        // Helpful instructions for the client
        instructions: {
          step1: 'Connect your wallet to Base Sepolia network',
          step2: 'Ensure you have USDC test tokens',
          step3: 'Approve and send payment transaction',
          step4: 'Get payment proof from facilitator',
          step5: 'Retry request with X-PAYMENT header'
        }
      },
      { status: 402 } // HTTP 402 Payment Required
    );
  }

  // STEP 3: Payment header is present - verify it
  try {
    // CRITICAL FIX: DO NOT decode the payment header before passing to settlePayment!
    // The settlePayment function expects the RAW base64-encoded string from X-PAYMENT header.
    // Decoding it here corrupts the signature and causes "invalid_exact_evm_payload_signature" error.
    //
    // Reference implementation (402-agent-commerce) passes paymentData directly without decoding.
    //
    // REMOVED: let paymentPayload = decodePayment(xPaymentHeader);
    // The paymentData should be passed AS-IS to settlePayment

    // Determine network configuration
    const isMainnetForVerification = NETWORK === 'base' || NETWORK === 'base:8453';

    // Build resource URL from request
    let resourceUrl;
    if (request.url) {
      const requestUrlObj = new URL(request.url);
      resourceUrl = `${requestUrlObj.origin}${requestUrlObj.pathname}`;
    } else {
      resourceUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/premium`;
    }
    resourceUrl = resourceUrl.replace(/\/$/, '');

    console.log('=== SETTLEMENT PARAMETERS ===');
    console.log('Resource URL:', resourceUrl);
    console.log('Merchant Address:', MERCHANT_ADDRESS);
    console.log('Network:', isMainnetForVerification ? 'Base Mainnet' : 'Base Sepolia');
    console.log('Payment Amount:', PAYMENT_AMOUNT);

    // Use Thirdweb facilitator to verify and settle the payment
    // Thirdweb facilitator requires:
    // - THIRDWEB_SECRET_KEY: Your Thirdweb secret key
    // - MERCHANT_ADDRESS: Your server wallet address (where payments are received)
    
    const thirdwebSecretKey = process.env.THIRDWEB_SECRET_KEY;
    
    if (!thirdwebSecretKey) {
      console.error('❌ THIRDWEB_SECRET_KEY is not set in environment variables');
      return NextResponse.json(
        {
          error: 'Facilitator configuration error',
          message: 'Thirdweb facilitator requires THIRDWEB_SECRET_KEY to be set.',
        },
        { status: 500 }
      );
    }

    if (!MERCHANT_ADDRESS || MERCHANT_ADDRESS === '0x0000000000000000000000000000000000000000') {
      console.error('❌ MERCHANT_ADDRESS is not set or invalid');
      return NextResponse.json(
        {
          error: 'Facilitator configuration error',
          message: 'MERCHANT_ADDRESS (server wallet address) must be set for Thirdweb facilitator.',
        },
        { status: 500 }
      );
    }

    console.log('Facilitator configuration:', {
      hasSecretKey: !!thirdwebSecretKey,
      secretKeyLength: thirdwebSecretKey?.length || 0,
      merchantAddress: MERCHANT_ADDRESS,
      network: NETWORK,
      isMainnet: NETWORK === 'base' || NETWORK === 'base:8453'
    });

    // Create Thirdweb client
    const thirdwebClient = createThirdwebClient({
      secretKey: thirdwebSecretKey,
    });

    // Create Thirdweb facilitator
    // The facilitator uses the server wallet address (MERCHANT_ADDRESS) to settle payments
    // CRITICAL: The facilitator will use the merchant wallet to pay gas fees and execute the transfer
    // The merchant wallet needs to have ETH for gas, and will receive USDC from the buyer
    const thirdwebFacilitator = facilitator({
      client: thirdwebClient,
      serverWalletAddress: MERCHANT_ADDRESS,
      waitUntil: 'confirmed', // Wait for transaction confirmation before returning
    });

    console.log('✅ Thirdweb facilitator configured');
    console.log('Facilitator will settle transactions using merchant wallet:', MERCHANT_ADDRESS);
    console.log('NOTE: Merchant wallet needs ETH for gas fees to execute USDC transfers');

    // Determine the Thirdweb chain object based on network
    const thirdwebChain = isMainnetForVerification ? base : baseSepolia;

    // Convert price from smallest units to dollar string format (e.g., "$0.10")
    // USDC has 6 decimals, so divide by 1000000
    const priceInDollars = (PAYMENT_AMOUNT / 1000000).toFixed(2);
    const priceString = `$${priceInDollars}`;

    console.log('=== SETTLING PAYMENT WITH THIRDWEB ===');
    console.log('Parameters:', {
      resourceUrl,
      method: 'GET',
      payTo: MERCHANT_ADDRESS,
      network: thirdwebChain.name,
      price: priceString,
    });

    let settlementResult;
    try {
      // Thirdweb's settlePayment handles both settlement and verification
      // It extracts requirements from paymentData automatically
      // Match the working example: use routeConfig for metadata
      settlementResult = await settlePayment({
        resourceUrl: resourceUrl,
        method: 'GET',
        paymentData: xPaymentHeader,
        payTo: MERCHANT_ADDRESS,
        network: thirdwebChain,
        price: priceString,
        routeConfig: {
          description: 'Access to premium video content',
          mimeType: 'video/mp4',
          outputSchema: {
            contentType: 'video',
            access: 'granted'
          }
        },
        facilitator: thirdwebFacilitator,
      });
      
      console.log('✅ Settlement completed:', {
        status: settlementResult.status,
        hasResponseBody: !!settlementResult.responseBody,
        responseHeaders: settlementResult.responseHeaders,
        paymentReceipt: settlementResult.paymentReceipt,
      });
      
      // Log transaction details if settlement was successful
      if (settlementResult.status === 200 && settlementResult.paymentReceipt) {
        console.log('💰 Payment transaction settled:', {
          transactionHash: settlementResult.paymentReceipt.transaction,
          from: settlementResult.paymentReceipt.from,
          to: settlementResult.paymentReceipt.to,
          amount: settlementResult.paymentReceipt.amount,
        });
      }
    } catch (settleError) {
      console.error('=== SETTLEMENT ERROR ===');
      console.error('Error message:', settleError.message);
      console.error('Error stack:', settleError.stack);

      return NextResponse.json(
        {
          error: 'Payment settlement error',
          message: settleError.message || 'Failed to settle payment with Thirdweb facilitator.',
          hint: 'The payment may be invalid or the facilitator service may be unavailable.',
        },
        { status: 402 }
      );
    }

    // Check settlement result
    if (settlementResult.status !== 200) {
      console.error('=== PAYMENT SETTLEMENT FAILED ===');
      console.error('Settlement status:', settlementResult.status);
      console.error('Response body:', JSON.stringify(settlementResult.responseBody, null, 2));

      // Return the error response from settlePayment
      return NextResponse.json(
        settlementResult.responseBody || {
          error: 'Payment verification failed',
          message: 'The payment proof is invalid or does not match the requirements.',
        },
        {
          status: settlementResult.status,
          headers: settlementResult.responseHeaders || {}
        }
      );
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
          'X-Payment-Network': NETWORK,
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
        hint: 'The facilitator service may be temporarily unavailable.'
      },
      { status: 402 }
    );
  }
}

