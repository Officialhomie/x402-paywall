'use client';

/**
 * x402 Payment Flow Frontend
 * 
 * This page demonstrates the complete x402 payment flow:
 * 1. User clicks "Access Premium Content"
 * 2. Frontend calls /api/premium
 * 3. Server returns 402 Payment Required
 * 4. Frontend displays payment requirements
 * 5. User completes payment (simulated or real)
 * 6. Frontend retries with X-PAYMENT header
 * 7. Server grants access
 * 
 * HOW THE FRONTEND HANDLES x402:
 * ===============================
 * 
 * STEP 1: Initial Request
 *   → fetch('/api/premium') without headers
 *   → Server checks for X-PAYMENT header
 *   → Header missing → Server returns 402
 * 
 * STEP 2: Handle 402 Response
 *   → Check response.status === 402
 *   → Parse response.json() to get payment requirements
 *   → Display payment UI to user
 *   → Show: amount, recipient, network, token
 * 
 * STEP 3: Process Payment
 *   → User connects wallet (MetaMask, Coinbase Wallet, etc.)
 *   → User approves USDC transfer transaction
 *   → Transaction is broadcast to blockchain
 *   → Wait for transaction confirmation
 * 
 * STEP 4: Get Payment Proof
 *   → After transaction confirmed, call facilitator
 *   → Facilitator verifies payment on-chain
 *   → Facilitator returns signed payment payload
 *   → This payload is the X-PAYMENT header value
 * 
 * STEP 5: Retry Request with Payment
 *   → fetch('/api/premium', { headers: { 'X-PAYMENT': payload } })
 *   → Server receives X-PAYMENT header
 *   → Server verifies with facilitator
 *   → If valid → Server returns 200 with content
 *   → Frontend displays success and protected content
 */

import { useState } from 'react';
import { useAccount, useConnect, useDisconnect, useSwitchChain, useWalletClient } from 'wagmi';
import { base, baseSepolia } from 'wagmi/chains';
import { createPaymentHeader } from 'x402/client';

const normalizeNetworkForSdk = (network) => {
  if (!network) return network;
  const value = network.toString().toLowerCase();

  if (value === 'base' || value === 'base-sepolia') {
    return value;
  }

  if (value.includes('8453')) {
    return 'base';
  }

  if (value.includes('84532')) {
    return 'base-sepolia';
  }

  return value;
};

export default function Home() {
  // Wagmi hooks for wallet connection
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const { data: walletClient } = useWalletClient();

  // State to track the payment flow
  const [status, setStatus] = useState('idle'); // idle, loading, payment-required, processing, success, error
  const [paymentInfo, setPaymentInfo] = useState(null);
  const [content, setContent] = useState(null);
  const [error, setError] = useState(null);
  const [step, setStep] = useState(0);

  /**
   * STEP 1: Make initial request to protected endpoint
   * This will trigger the 402 Payment Required response
   */
  const handleAccessContent = async () => {
    setStatus('loading');
    setError(null);
    setStep(1);
    
    try {
      // Make request WITHOUT X-PAYMENT header
      // Server will detect missing header and return 402
      const response = await fetch('/api/premium');
      
      // STEP 2: Check if we got 402 Payment Required
      if (response.status === 402) {
        // Parse the payment requirements from the 402 response
        const data = await response.json();
        
        // Extract payment info - must have x402Requirements
        const payment = data.payment || {};
        
        if (!payment.x402Requirements) {
          throw new Error('Invalid 402 response: x402Requirements missing. This endpoint requires proper x402 payment flow.');
        }
        
        const normalizedPayment = {
          ...payment,
          // Keep simplified fields for display only
          amount: payment.amount ? String(payment.amount) : '',
          token: payment.token || '',
          recipient: payment.recipient || '',
          network: payment.network || '',
          scheme: payment.scheme || 'exact',
          // x402Requirements is required - no fallback
          x402Requirements: payment.x402Requirements,
        };
        
        console.log('Payment required:', data);
        console.log('Payment details:', normalizedPayment);
        console.log('x402Requirements:', normalizedPayment.x402Requirements);
        
        setPaymentInfo(normalizedPayment);
        setStatus('payment-required');
        setStep(2);
        
      } else if (response.ok) {
        // This shouldn't happen on first request, but handle it
        const data = await response.json();
        setContent(data);
        setStatus('success');
        setStep(5);
      } else {
        throw new Error(`Unexpected status: ${response.status}`);
      }
    } catch (err) {
      setError(err.message);
      setStatus('error');
      console.error('Error accessing content:', err);
    }
  };

  /**
   * STEP 3 & 4: Process payment and get proof
   * 
   * Real implementation using wagmi and x402:
   * 1. Connect user's wallet if not connected
   * 2. Switch to Base Sepolia network if needed
   * 3. Use x402's createPaymentHeader which handles:
   *    - Creating USDC transfer transaction
   *    - Signing with wallet
   *    - Sending to blockchain
   *    - Getting payment proof from facilitator
   * 4. Retry request with X-PAYMENT header
   */
  const handleProcessPayment = async () => {
    setStatus('processing');
    setStep(3);
    
    try {
      // Main try block for payment processing
      // STEP 1: Ensure wallet is connected
      if (!isConnected) {
        // Connect to the first available connector
        if (connectors.length > 0) {
          await connect({ connector: connectors[0] });
          // Wait a bit for connection to establish
          await new Promise(resolve => setTimeout(resolve, 1000));
        } else {
          throw new Error('No wallet connectors available. Please install MetaMask or another wallet.');
        }
      }

      // STEP 2: Ensure we're on the correct network (Base or Base Sepolia)
      // Determine target network from payment requirements
      // Payment info uses "base:84532" or "base:8453" format, convert to wagmi chain
      const networkString = paymentInfo.network || 'base:84532';
      const targetNetwork = networkString === 'base:84532' || networkString.includes('84532') || networkString === 'base-sepolia'
        ? baseSepolia 
        : base;
      
      if (chainId !== targetNetwork.id) {
        setStatus('processing');
        setError(null);
        try {
          await switchChain({ chainId: targetNetwork.id });
          // Wait for chain switch
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (switchError) {
          throw new Error(`Please switch to ${targetNetwork.name} network in your wallet and try again.`);
        }
      }

      // STEP 3: Get wallet client
      if (!walletClient) {
        throw new Error('Wallet client not available. Please try connecting your wallet again.');
      }

      // STEP 4: Create payment authorization using x402/client
      setStep(4);

      // Validate payment requirements
      if (!paymentInfo.x402Requirements) {
        throw new Error('Payment requirements not found in API response.');
      }

      // Get payment requirements from 402 response
      const paymentRequirements = { ...paymentInfo.x402Requirements };

      if (!paymentRequirements.resource) {
        throw new Error('Payment requirements missing resource field.');
      }

      console.log('Original payment requirements (from 402):', JSON.stringify(paymentRequirements, null, 2));

      // CRITICAL FIX: createPaymentHeader() only accepts simplified network formats
      // But the backend expects EIP-155 format for verification
      // Solution: Convert for createPaymentHeader, but keep original in the signed payload
      const normalizedNetworkForCreation = normalizeNetworkForSdk(paymentRequirements.network);

      console.log('Network normalization:', {
        original: paymentRequirements.network,
        normalized: normalizedNetworkForCreation,
      });

      const requirementsForCreation = {
        ...paymentRequirements,
        network: normalizedNetworkForCreation
      };

      console.log('Network conversion:', {
        original: paymentRequirements.network,
        simplified: normalizedNetworkForCreation
      });

      // Use x402.org facilitator for creating the payment
      const facilitatorUrl = 'https://x402.org/facilitator';

      console.log('Creating payment header with simplified network:', normalizedNetworkForCreation);

      // Create payment header using x402/client
      // This creates an EIP-3009 authorization signature
      const paymentHeader = await createPaymentHeader(
        walletClient,
        1, // x402Version
        requirementsForCreation, // Use simplified network for creation
        { facilitatorUrl }
      );

      console.log('✅ Payment header created (length):', paymentHeader.length);

      // STEP 5: Send to server for verification and settlement
      console.log('Sending payment header to backend for verification...');
      const response = await fetch('/api/premium', {
        headers: {
          'X-PAYMENT': paymentHeader
        }
      });

      console.log('Backend response status:', response.status);

      if (response.ok) {
        // Payment verified! Access granted - expect video response
        const contentType = response.headers.get('content-type');

        if (!contentType || !contentType.includes('video/mp4')) {
          throw new Error('Expected video response but received: ' + contentType);
        }

        // Video file - create blob URL for playback
        const videoBlob = await response.blob();
        const videoUrl = URL.createObjectURL(videoBlob);
        setContent({
          access: 'granted',
          videoUrl: videoUrl,
          contentType: 'video',
          message: 'Payment verified! Video access granted.',
          timestamp: new Date().toISOString(),
        });
        setStatus('success');
        setStep(5);
      } else if (response.status === 402) {
        // Payment verification failed
        const data = await response.json();
        console.error('=== PAYMENT VERIFICATION FAILED (402 Response) ===');
        console.error('Server response:', JSON.stringify(data, null, 2));

        const errorReason = data.error || data.errorReason;
        let errorMessage = data.errorMessage || data.message || 'Payment verification failed';

        if (errorReason === 'invalid_exact_evm_payload_signature') {
          errorMessage = 'Facilitator rejected the payment signature. Refresh the payment request and re-sign in your wallet.';
        }

        setError(errorMessage);
        setPaymentInfo((prev) => {
          if (!Array.isArray(data.accepts) || data.accepts.length === 0) {
            return prev;
          }

          const updatedRequirements = data.accepts[0];

          if (!prev) {
            return {
              amount: '',
              token: '',
              recipient: '',
              network: '',
              networkName: '',
              description: '',
              x402Requirements: updatedRequirements,
            };
          }

          return {
            ...prev,
            x402Requirements: updatedRequirements,
          };
        });
        setStatus('error');
      } else {
        throw new Error(`Unexpected status: ${response.status}`);
      }
    } catch (error) {
      setError(error.message || 'An error occurred during payment processing');
      setStatus('error');
      console.error('Error in payment processing:', error);
    }
  };

  const handleReset = () => {
    setStatus('idle');
    setPaymentInfo(null);
    setContent(null);
    setError(null);
    setStep(0);
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            🎬 x402 Video Paywall - Mainnet
          </h1>
          <p className="text-lg text-gray-600">
            Real payment flow on Base mainnet - Pay with USDC to access premium video
          </p>
        </div>

        {/* Payment Flow Explanation */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <h2 className="text-2xl font-semibold mb-4">How x402 Payment Flow Works</h2>
          <div className="space-y-3 text-sm text-gray-700">
            <div className={`flex items-start ${step >= 1 ? 'text-blue-600' : 'text-gray-400'}`}>
              <span className="font-bold mr-2">1.</span>
              <span>Client requests protected resource → Server checks for X-PAYMENT header</span>
            </div>
            <div className={`flex items-start ${step >= 2 ? 'text-blue-600' : 'text-gray-400'}`}>
              <span className="font-bold mr-2">2.</span>
              <span>No header → Server returns HTTP 402 with payment requirements</span>
            </div>
            <div className={`flex items-start ${step >= 3 ? 'text-blue-600' : 'text-gray-400'}`}>
              <span className="font-bold mr-2">3.</span>
              <span>Client processes payment → User approves transaction in wallet</span>
            </div>
            <div className={`flex items-start ${step >= 4 ? 'text-blue-600' : 'text-gray-400'}`}>
              <span className="font-bold mr-2">4.</span>
              <span>Client gets payment proof from facilitator → Receives signed payload</span>
            </div>
            <div className={`flex items-start ${step >= 5 ? 'text-blue-600' : 'text-gray-400'}`}>
              <span className="font-bold mr-2">5.</span>
              <span>Client retries with X-PAYMENT header → Server verifies → Access granted</span>
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          {status === 'idle' && (
            <div className="text-center">
              <p className="text-gray-700 mb-6">
                Click the button below to attempt accessing premium content.
                The server will return a 402 Payment Required response with payment instructions.
              </p>
              <button
                onClick={handleAccessContent}
                className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
              >
                Access Premium Content
              </button>
            </div>
          )}

          {status === 'loading' && (
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-gray-700">Requesting access...</p>
            </div>
          )}

          {status === 'payment-required' && paymentInfo && (
            <div className="space-y-4">
              <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4">
                <h3 className="text-lg font-semibold text-yellow-800 mb-2">
                  💳 Payment Required (HTTP 402)
                </h3>
                <p className="text-yellow-700">
                  The server returned a 402 Payment Required response. 
                  Payment details are shown below.
                </p>
              </div>

              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-semibold mb-3">Payment Requirements:</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Amount:</span>
                    <span className="font-mono font-semibold">{paymentInfo.displayAmount || paymentInfo.amount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Network:</span>
                    <span className="font-mono">{paymentInfo.networkName || paymentInfo.network}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Recipient:</span>
                    <span className="font-mono text-xs">{paymentInfo.recipient}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Token:</span>
                    <span className="font-mono text-xs">{paymentInfo.token}</span>
                  </div>
                </div>
              </div>

              <div className="bg-blue-50 rounded-lg p-4">
                <h4 className="font-semibold mb-2">What happens next:</h4>
                <ol className="list-decimal list-inside space-y-1 text-sm text-gray-700">
                  <li>Connect your wallet to {paymentInfo.networkName || 'the required'} network</li>
                  <li>Ensure you have USDC tokens ({paymentInfo.networkName?.includes('Sepolia') ? 'test tokens' : 'mainnet tokens'})</li>
                  <li>Approve and send payment transaction</li>
                  <li>Get payment proof from facilitator</li>
                  <li>Retry request with X-PAYMENT header</li>
                </ol>
              </div>

              <button
                onClick={handleProcessPayment}
                className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
              >
                Process Payment (Demo)
              </button>
              
              <button
                onClick={handleReset}
                className="w-full bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold py-2 px-4 rounded-lg transition-colors"
              >
                Reset
              </button>
            </div>
          )}

          {status === 'processing' && (
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto mb-4"></div>
              <p className="text-gray-700 mb-2">Processing payment...</p>
              <p className="text-sm text-gray-500">
                In a real app, this would:
                <br />• Connect wallet and switch network
                <br />• Create USDC transfer transaction
                <br />• Wait for confirmation
                <br />• Get payment proof from facilitator
              </p>
            </div>
          )}

          {status === 'success' && content && (
            <div className="space-y-4">
              <div className="bg-green-50 border-l-4 border-green-400 p-4">
                <h3 className="text-lg font-semibold text-green-800 mb-2">
                  ✅ Payment Verified! Access Granted!
                </h3>
                <p className="text-green-700">
                  Your payment has been verified on Base mainnet. Enjoy the premium video!
                </p>
              </div>

              {content.videoUrl ? (
                // Video player
                <div className="bg-black rounded-lg overflow-hidden">
                  <video
                    controls
                    autoPlay
                    className="w-full h-auto"
                    src={content.videoUrl}
                  >
                    Your browser does not support the video tag.
                  </video>
                </div>
              ) : (
                <div className="bg-red-50 border-l-4 border-red-400 p-4">
                  <p className="text-red-700 font-semibold">
                    ⚠️ Video not available
                  </p>
                  <p className="text-red-600 text-sm mt-2">
                    Payment was verified but video could not be loaded. Please contact support.
                  </p>
                </div>
              )}

              <div className="bg-blue-50 rounded-lg p-4">
                <h4 className="font-semibold mb-2">Payment Verification Complete:</h4>
                <p className="text-sm text-gray-700">
                  ✅ Payment transaction confirmed on Base mainnet
                  <br />✅ Facilitator verified payment authenticity
                  <br />✅ Payment requirements matched exactly
                  <br />✅ Access granted to premium video content
                </p>
              </div>

              <button
                onClick={handleReset}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
              >
                Watch Another Video
              </button>
            </div>
          )}

          {status === 'error' && (
            <div className="space-y-4">
              <div className="bg-red-50 border-l-4 border-red-400 p-4">
                <h3 className="text-lg font-semibold text-red-800 mb-2">
                  ❌ Error
                </h3>
                <p className="text-red-700">{error || 'An error occurred'}</p>
              </div>

              <button
                onClick={handleReset}
                className="w-full bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold py-2 px-4 rounded-lg transition-colors"
              >
                Reset and Try Again
              </button>
            </div>
          )}
        </div>

        {/* Technical Details */}
        <div className="mt-6 bg-white rounded-lg shadow-lg p-6">
          <h2 className="text-xl font-semibold mb-4">Technical Details</h2>
          <div className="space-y-3 text-sm text-gray-700">
            <div>
              <strong>HTTP Status Code:</strong> 402 Payment Required
            </div>
            <div>
              <strong>Payment Header:</strong> X-PAYMENT (contains signed payment payload)
            </div>
            <div>
              <strong>Facilitator:</strong> Thirdweb Facilitator
            </div>
            <div>
              <strong>Network:</strong> {paymentInfo?.networkName || 'Base Sepolia'} (Chain ID: {paymentInfo?.network?.split(':')[1] || '84532'})
            </div>
            <div>
              <strong>Token:</strong> USDC (6 decimals)
            </div>
            <div>
              <strong>API Endpoint:</strong> <code className="bg-gray-100 px-2 py-1 rounded">/api/premium</code>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

