import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

declare const pg: {
  connection: Connection;
  PROGRAM_ID: PublicKey;
  wallet: { keypair: Keypair };
};

function serializeInit(amount: bigint): Buffer {
  const buf = Buffer.alloc(1 + 8);
  buf.writeUInt8(0, 0);
  buf.writeBigUInt64LE(amount, 1);
  return buf;
}

function serializeUpdate(value: number): Buffer {
  const buf = Buffer.alloc(1 + 4);
  buf.writeUInt8(1, 0);
  buf.writeUInt32LE(value, 1);
  return buf;
}

const [statePda] = PublicKey.findProgramAddressSync(
  [Buffer.from("state")],
  pg.PROGRAM_ID,
);

const initTx = new Transaction().add({
  programId: pg.PROGRAM_ID,
  keys: [
    { pubkey: pg.wallet.keypair.publicKey, isSigner: true, isWritable: true },
    { pubkey: statePda, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data: serializeInit(BigInt(100)),
});
const initSig = await sendAndConfirmTransaction(pg.connection, initTx, [pg.wallet.keypair]);
console.log("Init tx:", initSig);

const updateTx = new Transaction().add({
  programId: pg.PROGRAM_ID,
  keys: [{ pubkey: statePda, isSigner: false, isWritable: true }],
  data: serializeUpdate(42),
});
const updateSig = await sendAndConfirmTransaction(pg.connection, updateTx, [pg.wallet.keypair]);
console.log("Update tx:", updateSig);
