
import * as fs from "fs";
import * as path from "path";
import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  burn,
  closeAccount,
  createAssociatedTokenAccount,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  mintTo,
} from "@solana/spl-token";
import type { Connection } from "@solana/web3.js";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

function loadKeypairFromJson(filePath: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function vaultPda(mint: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), mint.toBuffer()],
    programId
  )[0];
}

function userDepositPda(
  vault: PublicKey,
  user: PublicKey,
  programId: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("deposit"), vault.toBuffer(), user.toBuffer()],
    programId
  )[0];
}

type TeardownCtx = {
  conn: Connection;
  program: Program;
  payerA: Keypair;
  walletA: PublicKey;
  userB: Keypair;
  funder: Keypair;
  mint: PublicKey | null;
  vaultPk: PublicKey | null;
  ataA: PublicKey | null;
  ataB: PublicKey | null;
};

async function safeCleanup(
  label: string,
  fn: () => Promise<void>
): Promise<void> {
  try {
    await fn();
    console.log("[cleanup]", label);
  } catch (e) {
    console.warn("[cleanup skip]", label, "-", String(e));
  }
}

/** Best-effort: undo SPL + program accounts created by this demo, then return B’s SOL to funder. */
async function teardown(ctx: TeardownCtx): Promise<void> {
  const {
    conn,
    program,
    payerA,
    walletA,
    userB,
    funder,
    mint,
    vaultPk,
    ataA,
    ataB,
  } = ctx;

  if (!mint || !vaultPk) {
    console.log("[cleanup] nothing to tear down (early exit)");
    return;
  }

  const vaultTokenAta = getAssociatedTokenAddressSync(
    mint,
    vaultPk,
    true,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const userDepositA = userDepositPda(vaultPk, walletA, program.programId);
  const userDepositB = userDepositPda(vaultPk, userB.publicKey, program.programId);

  await safeCleanup("burn + close ATA A", async () => {
    if (!ataA) return;
    const info = await conn.getAccountInfo(ataA);
    if (!info) return;
    const acc = await getAccount(conn, ataA);
    if (acc.amount > 0n) {
      await burn(
        conn,
        payerA,
        ataA,
        mint,
        payerA,
        acc.amount,
        [],
        undefined,
        TOKEN_PROGRAM_ID
      );
    }
    const again = await conn.getAccountInfo(ataA);
    if (!again) return;
    await closeAccount(
      conn,
      payerA,
      ataA,
      walletA,
      payerA,
      [],
      undefined,
      TOKEN_PROGRAM_ID
    );
  });

  await safeCleanup("burn + close ATA B", async () => {
    if (!ataB) return;
    const info = await conn.getAccountInfo(ataB);
    if (!info) return;
    const acc = await getAccount(conn, ataB);
    if (acc.amount > 0n) {
      await burn(
        conn,
        payerA,
        ataB,
        mint,
        userB,
        acc.amount,
        [],
        undefined,
        TOKEN_PROGRAM_ID
      );
    }
    const again = await conn.getAccountInfo(ataB);
    if (!again) return;
    await closeAccount(
      conn,
      payerA,
      ataB,
      walletA,
      userB,
      [],
      undefined,
      TOKEN_PROGRAM_ID
    );
  });

  await safeCleanup("closeUserDepositRecord A", async () => {
    const info = await conn.getAccountInfo(userDepositA);
    if (!info) return;
    await program.methods
      .closeUserDepositRecord()
      .accounts({
        user: walletA,
        mint,
        vault: vaultPk,
        userDeposit: userDepositA,
      })
      .rpc();
  });

  await safeCleanup("closeUserDepositRecord B", async () => {
    const info = await conn.getAccountInfo(userDepositB);
    if (!info) return;
    await program.methods
      .closeUserDepositRecord()
      .accounts({
        user: userB.publicKey,
        mint,
        vault: vaultPk,
        userDeposit: userDepositB,
      })
      .signers([userB])
      .rpc();
  });

  await safeCleanup("closeVaultTokenAta", async () => {
    const info = await conn.getAccountInfo(vaultTokenAta);
    if (!info) return;
    await program.methods
      .closeVaultTokenAta()
      .accounts({
        payer: walletA,
        mint,
        vault: vaultPk,
        vaultToken: vaultTokenAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
  });

  await safeCleanup("closeVaultState", async () => {
    const info = await conn.getAccountInfo(vaultPk);
    if (!info) return;
    await program.methods
      .closeVaultState()
      .accounts({
        payer: walletA,
        mint,
        vault: vaultPk,
      })
      .rpc();
  });

  await safeCleanup("sweep SOL B → funder", async () => {
    const bal = await conn.getBalance(userB.publicKey);
    const minForFee = 5000;
    if (bal <= minForFee) return;
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: userB.publicKey,
        toPubkey: funder.publicKey,
        lamports: bal - minForFee,
      })
    );
    await sendAndConfirmTransaction(conn, tx, [userB], {
      commitment: "confirmed",
    });
  });
}

(async () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const ws = anchor.workspace as Record<string, Program | undefined>;
  const program = (ws.Lecture11Vault ??
    ws.lecture11Vault ??
    ws.lecture_11_vault) as Program | null;
  if (!program) {
    throw new Error("Program not in anchor.workspace — run `anchor build`.");
  }

  const conn = provider.connection;
  const payerA = (provider.wallet as anchor.Wallet).payer;
  const walletA = provider.wallet.publicKey;

  const funderPath =
    process.env.WALLET_KEYPAIR?.trim() ||
    path.join(__dirname, "..", "wallet-keypair.json");
  const funder = loadKeypairFromJson(funderPath);
  const fundLamports = Number(
    process.env.FUND_USER_B_LAMPORTS ?? String(LAMPORTS_PER_SOL)
  );
  if (!Number.isFinite(fundLamports) || fundLamports <= 0) {
    throw new Error("FUND_USER_B_LAMPORTS must be a positive number");
  }

  const userB = Keypair.generate();

  const td: TeardownCtx = {
    conn,
    program,
    payerA,
    walletA,
    userB,
    funder,
    mint: null,
    vaultPk: null,
    ataA: null,
    ataB: null,
  };

  try {
    const fundTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: funder.publicKey,
        toPubkey: userB.publicKey,
        lamports: fundLamports,
      })
    );
    const fundSig = await sendAndConfirmTransaction(
      conn,
      fundTx,
      [funder],
      { commitment: "confirmed" }
    );
    console.log(
      "Fund user B from",
      funderPath,
      "(" + funder.publicKey.toBase58() + "):",
      fundLamports,
      "lamports, sig",
      fundSig
    );

    const DECIMALS = 9;
    const ONE = new BN(10).pow(new BN(DECIMALS));

    // New random mint keypair every run → new SPL mint account (no reuse / no env mint).
    const mintKp = Keypair.generate();
    const mint = await createMint(
      conn,
      payerA,
      walletA,
      walletA,
      DECIMALS,
      mintKp,
      undefined,
      TOKEN_PROGRAM_ID
    );
    td.mint = mint;
    console.log("mint:", mint.toBase58());

    const vaultPk = vaultPda(mint, program.programId);
    td.vaultPk = vaultPk;
    const vaultTokenAta = getAssociatedTokenAddressSync(
      mint,
      vaultPk,
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    await program.methods
      .initializeVault()
      .accounts({
        payer: walletA,
        mint,
        vault: vaultPk,
        vaultToken: vaultTokenAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("initializeVault ok");

    const ataA = await createAssociatedTokenAccount(
      conn,
      payerA,
      mint,
      walletA,
      undefined,
      TOKEN_PROGRAM_ID
    );
    const ataB = await createAssociatedTokenAccount(
      conn,
      payerA,
      mint,
      userB.publicKey,
      undefined,
      TOKEN_PROGRAM_ID
    );
    td.ataA = ataA;
    td.ataB = ataB;
    console.log("ATAs A/B:", ataA.toBase58(), ataB.toBase58());

    const giveEach = new BN(100).mul(ONE);
    await mintTo(
      conn,
      payerA,
      mint,
      ataA,
      payerA,
      BigInt(giveEach.toString()),
      [],
      undefined,
      TOKEN_PROGRAM_ID
    );
    await mintTo(
      conn,
      payerA,
      mint,
      ataB,
      payerA,
      BigInt(giveEach.toString()),
      [],
      undefined,
      TOKEN_PROGRAM_ID
    );
    console.log("mintTo A/B:", giveEach.toString(), "each (base units)");

    const depA = new BN(50).mul(ONE);
    const depB = new BN(40).mul(ONE);
    const userDepositA = userDepositPda(vaultPk, walletA, program.programId);
    const userDepositB = userDepositPda(vaultPk, userB.publicKey, program.programId);

    await program.methods
      .deposit(depA)
      .accounts({
        user: walletA,
        mint,
        vault: vaultPk,
        vaultToken: vaultTokenAta,
        userToken: ataA,
        userDeposit: userDepositA,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("deposit A:", depA.toString());

    await program.methods
      .deposit(depB)
      .accounts({
        user: userB.publicKey,
        mint,
        vault: vaultPk,
        vaultToken: vaultTokenAta,
        userToken: ataB,
        userDeposit: userDepositB,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([userB])
      .rpc();
    console.log("deposit B:", depB.toString());

    const wA1 = new BN(20).mul(ONE);
    const wB1 = new BN(15).mul(ONE);

    await program.methods
      .withdraw(wA1)
      .accounts({
        user: walletA,
        mint,
        vault: vaultPk,
        vaultToken: vaultTokenAta,
        userToken: ataA,
        userDeposit: userDepositA,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
    console.log("withdraw A (partial):", wA1.toString());

    await program.methods
      .withdraw(wB1)
      .accounts({
        user: userB.publicKey,
        mint,
        vault: vaultPk,
        vaultToken: vaultTokenAta,
        userToken: ataB,
        userDeposit: userDepositB,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([userB])
      .rpc();
    console.log("withdraw B (partial):", wB1.toString());

    const restA = depA.sub(wA1);
    const restB = depB.sub(wB1);

    await program.methods
      .withdraw(restA)
      .accounts({
        user: walletA,
        mint,
        vault: vaultPk,
        vaultToken: vaultTokenAta,
        userToken: ataA,
        userDeposit: userDepositA,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
    console.log("withdraw A (rest):", restA.toString());

    await program.methods
      .withdraw(restB)
      .accounts({
        user: userB.publicKey,
        mint,
        vault: vaultPk,
        vaultToken: vaultTokenAta,
        userToken: ataB,
        userDeposit: userDepositB,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([userB])
      .rpc();
    console.log("withdraw B (rest):", restB.toString());

    const vaultTok = await getAccount(conn, vaultTokenAta);
    console.log("vault token balance (should be 0):", vaultTok.amount.toString());
  } catch (e) {
    console.error(e);
    if (typeof process !== "undefined") {
      process.exitCode = 1;
    }
  } finally {
    console.log("--- teardown ---");
    await teardown(td);
  }
})();
