describe("user_counter", () => {
    const wallet = () => pg.wallet.publicKey;
  
    let createdFresh = false;
  
    function counterPda(user) {
      return web3.PublicKey.findProgramAddressSync(
        [Buffer.from("counter"), user.toBuffer()],
        pg.program.programId
      );
    }
  
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
  
    async function readCount(counterPk) {
      const acc = await pg.program.account.userCounter.fetch(counterPk);
      return acc.count.toNumber();
    }
  
    async function waitForCount(counterPk, want, timeoutMs = 20_000) {
      const t0 = Date.now();
      let last = -1;
      while (Date.now() - t0 < timeoutMs) {
        last = await readCount(counterPk);
        if (last === want) return last;
        await sleep(150);
      }
      return last;
    }
  
    before(async () => {
      const w = wallet();
      const [counterPk] = counterPda(w);
      const info = await pg.connection.getAccountInfo(counterPk);
      if (!info) {
        await pg.program.methods
          .initialize()
          .accounts({
            user: w,
            counter: counterPk,
            systemProgram: web3.SystemProgram.programId,
          })
          .rpc();
        createdFresh = true;
      }
    });
  
    it("PDA exists, authority is wallet; count 0 only when just created", async () => {
      const w = wallet();
      const [counterPk] = counterPda(w);
      const acc = await pg.program.account.userCounter.fetch(counterPk);
      assert(acc.authority.equals(w));
      if (createdFresh) {
        assert.strictEqual(acc.count.toNumber(), 0);
      }
    });
  
    it("increment adds 1", async () => {
      const w = wallet();
      const [counterPk] = counterPda(w);
      const before = await readCount(counterPk);
      await pg.program.methods
        .increment()
        .accounts({
          user: w,
          counter: counterPk,
        })
        .rpc();
      const after = await waitForCount(counterPk, before + 1);
      assert.strictEqual(after, before + 1);
    });
  
    it("increment adds 1 again", async () => {
      const w = wallet();
      const [counterPk] = counterPda(w);
      const before = await readCount(counterPk);
      await pg.program.methods
        .increment()
        .accounts({
          user: w,
          counter: counterPk,
        })
        .rpc();
      const after = await waitForCount(counterPk, before + 1);
      assert.strictEqual(after, before + 1);
    });
  });
  