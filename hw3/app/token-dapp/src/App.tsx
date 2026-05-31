import { useState } from 'react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import {
  Keypair,
  SystemProgram,
  Transaction,
  PublicKey,
} from '@solana/web3.js'
import {
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createInitializeMintInstruction,
  getMint,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
} from '@solana/spl-token'

interface MintInfo {
  address: string
  decimals: number
  supply: string
  mintAuthority: string | null
  freezeAuthority: string | null
}

export default function App() {
  const { publicKey, connected, signTransaction, sendTransaction } = useWallet()
  const { connection } = useConnection()

  // create token form
  const [decimals, setDecimals] = useState('6')
  const [mintAuthority, setMintAuthority] = useState('')
  const [freezeAuthority, setFreezeAuthority] = useState('')
  const [initialSupply, setInitialSupply] = useState('0')

  // deployed mint state
  const [mintInfo, setMintInfo] = useState<MintInfo | null>(null)
  const [mintPubkey, setMintPubkey] = useState<PublicKey | null>(null)

  // load existing mint
  const [existingMintAddress, setExistingMintAddress] = useState('')

  // mint-to form
  const [targetWallet, setTargetWallet] = useState('')
  const [mintAmount, setMintAmount] = useState('')

  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)

  const mintAuthPubkey = mintAuthority ? tryParsePubkey(mintAuthority) ?? publicKey : publicKey
  const freezeAuthPubkey = freezeAuthority ? tryParsePubkey(freezeAuthority) : null

  async function handleCreateMint() {
    if (!publicKey || !signTransaction) return
    setLoading(true)
    setStatus('')
    try {
      const newMintKeypair = Keypair.generate()
      const dec = parseInt(decimals)
      const authority = mintAuthPubkey ?? publicKey

      const lamports = await connection.getMinimumBalanceForRentExemption(MINT_SIZE)

      const tx = new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: publicKey,
          newAccountPubkey: newMintKeypair.publicKey,
          space: MINT_SIZE,
          lamports,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMintInstruction(
          newMintKeypair.publicKey,
          dec,
          authority,
          freezeAuthPubkey,
          TOKEN_PROGRAM_ID,
        ),
      )

      tx.feePayer = publicKey
      const latestBlockhash = await connection.getLatestBlockhash()
      tx.recentBlockhash = latestBlockhash.blockhash

      tx.partialSign(newMintKeypair)
      const signed = await signTransaction(tx)
      const sig = await connection.sendRawTransaction(signed.serialize())
      await connection.confirmTransaction({ signature: sig, ...latestBlockhash }, 'confirmed')

      setStatus(`Mint deployed! Transaction: ${sig}`)
      setMintPubkey(newMintKeypair.publicKey)

      const supplyAmount = parseFloat(initialSupply)
      if (supplyAmount > 0) {
        await doMintTo(newMintKeypair.publicKey, authority, authority, supplyAmount, dec)
      }

      await refreshMintInfo(newMintKeypair.publicKey)
    } catch (e: unknown) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setLoading(false)
    }
  }

  async function doMintTo(
    mint: PublicKey,
    payer: PublicKey,
    destination: PublicKey,
    amount: number,
    dec: number,
  ) {
    const ataAddress = await getAssociatedTokenAddress(
      mint,
      destination,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    )

    const tx = new Transaction()

    const ataInfo = await connection.getAccountInfo(ataAddress)
    if (!ataInfo) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          payer,
          ataAddress,
          destination,
          mint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
      )
    }

    const rawAmount = BigInt(Math.round(amount * 10 ** dec))
    tx.add(
      createMintToInstruction(mint, ataAddress, payer, rawAmount, [], TOKEN_PROGRAM_ID),
    )

    const latestBlockhash = await connection.getLatestBlockhash()
    tx.recentBlockhash = latestBlockhash.blockhash
    tx.feePayer = payer
    const sig = await sendTransaction(tx, connection, { skipPreflight: true })
    await connection.confirmTransaction({ signature: sig, ...latestBlockhash }, 'confirmed')

    setStatus(prev => prev + `\nMint successful! Transaction: ${sig}`)
  }

  async function handleLoadMint() {
    setLoading(true)
    setStatus('')
    try {
      const pubkey = tryParsePubkey(existingMintAddress)
      if (!pubkey) throw new Error('Invalid mint address')
      setMintPubkey(pubkey)
      await refreshMintInfo(pubkey)
      setStatus('Mint loaded!')
    } catch (e: unknown) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setLoading(false)
    }
  }

  async function handleMintTo() {
    if (!mintPubkey || !publicKey) return
    setLoading(true)
    setStatus('')
    try {
      const destination = tryParsePubkey(targetWallet)
      if (!destination) throw new Error('Invalid wallet address')
      const amount = parseFloat(mintAmount)
      if (isNaN(amount) || amount <= 0) throw new Error('Invalid amount')
      const dec = mintInfo?.decimals ?? parseInt(decimals)
      const authority = mintAuthPubkey ?? publicKey
      await doMintTo(mintPubkey, authority, destination, amount, dec)
      await refreshMintInfo(mintPubkey)
    } catch (e: unknown) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setLoading(false)
    }
  }

  async function refreshMintInfo(pubkey: PublicKey) {
    const data = await getMint(connection, pubkey, 'confirmed', TOKEN_PROGRAM_ID)
    setMintInfo({
      address: pubkey.toBase58(),
      decimals: data.decimals,
      supply: (Number(data.supply) / 10 ** data.decimals).toString(),
      mintAuthority: data.mintAuthority?.toBase58() ?? null,
      freezeAuthority: data.freezeAuthority?.toBase58() ?? null,
    })
  }

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Solana Token DApp</h1>

      <div style={styles.card}>
        <WalletMultiButton />
        {connected && (
          <p style={styles.connected}>Connected: {publicKey?.toBase58()}</p>
        )}
      </div>

      {connected && !mintInfo && (
        <div style={styles.card}>
          <h2>Load Existing Mint</h2>
          <label style={styles.label}>Mint Address</label>
          <input
            style={styles.input}
            placeholder="PublicKey..."
            value={existingMintAddress}
            onChange={e => setExistingMintAddress(e.target.value)}
          />
          <button style={styles.buttonSecondary} onClick={handleLoadMint} disabled={loading}>
            {loading ? 'Loading...' : 'Load Mint'}
          </button>
        </div>
      )}

      {connected && !mintInfo && (
        <div style={styles.card}>
          <h2>Create Token</h2>

          <label style={styles.label}>Decimals</label>
          <input
            style={styles.input}
            type="number"
            min="0"
            max="9"
            value={decimals}
            onChange={e => setDecimals(e.target.value)}
          />

          <label style={styles.label}>Mint Authority (leave empty = your wallet)</label>
          <input
            style={styles.input}
            placeholder="PublicKey..."
            value={mintAuthority}
            onChange={e => setMintAuthority(e.target.value)}
          />

          <label style={styles.label}>Freeze Authority (leave empty = none)</label>
          <input
            style={styles.input}
            placeholder="PublicKey..."
            value={freezeAuthority}
            onChange={e => setFreezeAuthority(e.target.value)}
          />

          <label style={styles.label}>Initial Supply (0 = mint later)</label>
          <input
            style={styles.input}
            type="number"
            min="0"
            value={initialSupply}
            onChange={e => setInitialSupply(e.target.value)}
          />

          <button style={styles.button} onClick={handleCreateMint} disabled={loading}>
            {loading ? 'Deploying...' : 'Deploy Token'}
          </button>
        </div>
      )}

      {mintInfo && (
        <div style={styles.card}>
          <h2>Mint Account</h2>
          <Row label="Address" value={mintInfo.address} />
          <Row label="Decimals" value={mintInfo.decimals.toString()} />
          <Row label="Supply" value={mintInfo.supply} />
          <Row label="Mint Authority" value={mintInfo.mintAuthority ?? '—'} />
          <Row label="Freeze Authority" value={mintInfo.freezeAuthority ?? '—'} />
        </div>
      )}

      {mintInfo && (
        <div style={styles.card}>
          <h2>Mint Tokens</h2>

          <label style={styles.label}>Destination Wallet</label>
          <input
            style={styles.input}
            placeholder="PublicKey..."
            value={targetWallet}
            onChange={e => setTargetWallet(e.target.value)}
          />

          <label style={styles.label}>Amount</label>
          <input
            style={styles.input}
            type="number"
            min="0"
            value={mintAmount}
            onChange={e => setMintAmount(e.target.value)}
          />

          <button style={styles.button} onClick={handleMintTo} disabled={loading}>
            {loading ? 'Minting...' : 'Mint Tokens'}
          </button>
        </div>
      )}

      {status && (
        <div style={styles.status}>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {status}
          </pre>
        </div>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <span style={{ color: '#888', marginRight: 8 }}>{label}:</span>
      <span style={{ fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all' }}>
        {value}
      </span>
    </div>
  )
}

function tryParsePubkey(value: string): PublicKey | null {
  try {
    return new PublicKey(value.trim())
  } catch {
    return null
  }
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    maxWidth: 640,
    margin: '0 auto',
    padding: '32px 16px',
    fontFamily: 'sans-serif',
  },
  title: {
    fontSize: 28,
    marginBottom: 24,
  },
  card: {
    background: '#f9f9f9',
    border: '1px solid #e0e0e0',
    borderRadius: 12,
    padding: 24,
    marginBottom: 20,
  },
  label: {
    display: 'block',
    fontSize: 13,
    color: '#555',
    marginBottom: 4,
    marginTop: 12,
  },
  input: {
    width: '100%',
    padding: '8px 10px',
    fontSize: 14,
    border: '1px solid #ccc',
    borderRadius: 6,
    boxSizing: 'border-box',
  },
  button: {
    marginTop: 16,
    padding: '10px 24px',
    background: '#512da8',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 15,
    cursor: 'pointer',
  },
  buttonSecondary: {
    marginTop: 16,
    padding: '10px 24px',
    background: 'transparent',
    color: '#512da8',
    border: '2px solid #512da8',
    borderRadius: 8,
    fontSize: 15,
    cursor: 'pointer',
  },
  connected: {
    marginTop: 8,
    fontSize: 12,
    color: '#555',
    wordBreak: 'break-all',
  },
  status: {
    background: '#1e1e1e',
    color: '#d4d4d4',
    borderRadius: 8,
    padding: 16,
    fontSize: 13,
  },
}
