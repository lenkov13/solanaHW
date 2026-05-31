import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

declare var pg: { program?: Program } | undefined;

function sleep(ms) {
  return new Promise((resolve) => {
    if (typeof setTimeout === "function") {
      setTimeout(resolve, ms);
      return;
    }
    const end = Date.now() + ms;
    while (Date.now() < end) {
    }
    resolve();
  });
}

function counterPda(user: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("counter"), user.toBuffer()],
    programId
  );
}

function getProgram(): Program {
  if (typeof pg !== "undefined" && pg != null && pg.program != null) {
    return pg.program;
  }
  const ws = anchor.workspace as Record<string, Program | undefined>;
  const program =
    ws.userCounter ?? ws.user_counter ?? ws.UserCounter;
  if (!program) {
    throw new Error(
      "No program: build in SolPG, or ensure anchor.workspace has your program (try userCounter / user_counter / UserCounter)."
    );
  }
  return program;
}

(async () => {
  try {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = getProgram();
    const user = provider.wallet.publicKey;
    const [counterPk] = counterPda(user, program.programId);

    const initSig = await program.methods
      .initialize()
      .accounts({
        user,
        counter: counterPk,
        systemProgram: SystemProgram.programId,
      });
      //.rpc();
    await sleep(200);
    console.log("initialize:", initSig);

    let state = await program.account.userCounter.fetch(counterPk);
    console.log("count:", state.count.toString());

    const incSig = await program.methods
      .increment()
      .accounts({
        user,
        counter: counterPk,
      })
      .rpc();
    await sleep(200);
    console.log("increment:", incSig);

    state = await program.account.userCounter.fetch(counterPk);
    console.log("count after increment:", state.count.toString());

    const recipient = Keypair.generate();
    const conn = provider.connection;

    const sendSig = await program.methods
      .sendOneSol()
      .accounts({
        from: user,
        to: recipient.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    await sleep(200);
    state = await program.account.userCounter.fetch(counterPk);
    console.log("send_one_sol (1 SOL to new keypair):", sendSig);
    console.log("recipient balance (lamports):", await conn.getBalance(recipient.publicKey));
  } catch (e) {
    console.error(e);
    if (typeof process !== "undefined") {
      process.exitCode = 1;
    }
  }
})();
