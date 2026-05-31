import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui'
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom'
import '@solana/wallet-adapter-react-ui/styles.css'
import './index.css'
import App from './App'

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, color: 'red', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
          <b>React Error:</b>{'\n'}
          {(this.state.error as Error).message}{'\n\n'}
          {(this.state.error as Error).stack}
        </div>
      )
    }
    return this.props.children
  }
}

const wallets = [new PhantomWalletAdapter()]
const endpoint = 'https://api.devnet.solana.com'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ConnectionProvider endpoint={endpoint}>
        <WalletProvider wallets={wallets} autoConnect>
          <WalletModalProvider>
            <App />
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </ErrorBoundary>
  </React.StrictMode>
)
