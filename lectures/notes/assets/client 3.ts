import {
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

const USER_COUNTER_SEED = "user_counter";
const USER_COUNTER_SPACE = 8 + 32 + 1;

interface UserCounterState {
  count: bigint;
  user: Uint8Array;
  bump: number;
}

enum IxTag {
  InitUserCounter = 0,
  Increment = 1,
}

function buildInitIxData(): Buffer {
  return Buffer.from([IxTag.InitUserCounter]);
}

function buildIncrementIxData(): Buffer {
  return Buffer.from([IxTag.Increment]);
}

function decodeState(data: Buffer): UserCounterState {
  if (data.length < USER_COUNTER_SPACE) {
    throw new Error(`decodeState: need at least ${USER_COUNTER_SPACE} bytes, got ${data.length}`);
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = view.getBigUint64(0, true);
  const user = new Uint8Array(data.buffer, data.byteOffset + 8, 32);
  const bump = data[8 + 32];
  return { count, user, bump };
}

/** Init PDA (if needed), increment once, read and log on-chain state. */
async function runInitIncrementRead(user: Keypair, userPda: PublicKey): Promise<void> {
  const existing = await pg.connection.getAccountInfo(userPda);
  const alreadyInit =
    existing !== null &&
    existing.owner.equals(pg.PROGRAM_ID) &&
    existing.data.length > 0;

  if (!alreadyInit) {
    const initIx = new TransactionInstruction({
      programId: pg.PROGRAM_ID,
      keys: [
        { pubkey: user.publicKey, isSigner: true, isWritable: true },
        { pubkey: userPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: buildInitIxData(),
    });

    await sendAndConfirmTransaction(pg.connection, new Transaction().add(initIx), [user]);
  } else {
    console.log("[init] skipped — PDA already initialized (re-run safe)");
  }

  const incIx = new TransactionInstruction({
    programId: pg.PROGRAM_ID,
    keys: [
      { pubkey: user.publicKey, isSigner: true, isWritable: false },
      { pubkey: userPda, isSigner: false, isWritable: true },
    ],
    data: buildIncrementIxData(),
  });

  await sendAndConfirmTransaction(pg.connection, new Transaction().add(incIx), [user]);

  const accountInfo = await pg.connection.getAccountInfo(userPda);
  if (!accountInfo) {
    throw new Error("runInitIncrementRead: PDA account missing after init");
  }
  const state = decodeState(accountInfo.data);
  console.log("[init + increment + read]", {
    count: Number(state.count),
    user: new PublicKey(state.user).toBase58(),
    bump: state.bump,
  });
}

void (async () => {
  const user = pg.wallet.keypair;

  const [userPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(USER_COUNTER_SEED), user.publicKey.toBuffer()],
    pg.PROGRAM_ID
  );

  await runInitIncrementRead(user, userPda);
})();


// Задание: имеется код, который для юзера создает счетчик

// Сделать:
// - сброс счетчика
// - отдельный PDA под юзера, который хранит его имя
// - при обновлении счетчика юзера, читать его имя из другого PDA и выводить в msg!
