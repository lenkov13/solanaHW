
use anchor_lang::prelude::*;

const MAX_COUNT: u64 = 1_000_000;

const ONE_SOL_LAMPORTS: u64 = 1_000_000_000;

declare_id!("3TJGjxvFpEfKSQWuiezE32L39oU8JYkkrpW6mJdqacyG");

#[program]
pub mod user_counter {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let c = &mut ctx.accounts.counter;
        c.authority = ctx.accounts.user.key();
        c.count = 0;
        Ok(())
    }

    pub fn increment(ctx: Context<Increment>) -> Result<()> {
        let c = &mut ctx.accounts.counter;
        c.count = c.count.checked_add(1).ok_or(error!(ErrorCode::Overflow))?;
        Ok(())
    }
    pub fn send_one_sol(ctx: Context<SendOneSol>) -> Result<()> {
        let from = ctx.accounts.from.to_account_info();
        let to = ctx.accounts.to.to_account_info();
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer { from, to },
            ),
            ONE_SOL_LAMPORTS,
        )?;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        mut,
        signer,
        constraint = user.key() != Pubkey::default() @ ErrorCode::EmptySigner
    )]
    pub user: Signer<'info>,
    #[account(
        init,
        payer = user,
        space = 8 + UserCounter::INIT_SPACE,
        seeds = [b"counter", user.key().as_ref()],
        bump
    )]
    pub counter: Account<'info, UserCounter>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Increment<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"counter", authority.key().as_ref()],
        bump,
        //constraint = counter.authority == authority.key() @ ErrorCode::Unauthorized,
        has_one = authority @ ErrorCode::Unauthorized,
        constraint = counter.count < MAX_COUNT @ ErrorCode::CounterAtLimit
    )]
    pub counter: Account<'info, UserCounter>,
}

#[derive(Accounts)]
pub struct SendOneSol<'info> {
    #[account(mut)]
    pub from: Signer<'info>,
    #[account(mut)]
    pub to: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct UserCounter {
    pub authority: Pubkey,
    pub count: u64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Counter overflow")]
    Overflow,
    #[msg("Only the authority can increment this counter")]
    Unauthorized,
    #[msg("Signer pubkey cannot be default")]
    EmptySigner,
    #[msg("Counter reached the configured maximum (cannot increment further)")]
    CounterAtLimit,
}
