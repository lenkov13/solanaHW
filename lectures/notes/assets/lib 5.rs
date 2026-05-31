use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, Transfer};

declare_id!("8aX6h1u2pAhLiVcXMPcksRzJuxQGwjwHzm9WZBGceWYV");

#[program]
pub mod lecture_11_vault {
    use super::*;

    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.mint = ctx.accounts.mint.key();
        vault.bump = ctx.bumps.vault;
        Ok(())
    }

    pub fn deposit(ctx: Context<DepositTokens>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::ZeroAmount);

        let cpi = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_token.to_account_info(),
                to: ctx.accounts.vault_token.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        );
        token::transfer(cpi, amount)?;

        let d = &mut ctx.accounts.user_deposit;
        d.bump = ctx.bumps.user_deposit;
        d.deposited = d
            .deposited
            .checked_add(amount)
            .ok_or(error!(ErrorCode::Overflow))?;
        Ok(())
    }

    pub fn withdraw(ctx: Context<WithdrawTokens>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::ZeroAmount);

        let d = &mut ctx.accounts.user_deposit;
        require!(d.deposited >= amount, ErrorCode::InsufficientDeposited);

        let mint_key = ctx.accounts.vault.mint;
        let bump = ctx.accounts.vault.bump;
        let seeds: &[&[u8]] = &[b"vault", mint_key.as_ref(), &[bump]];
        let signer = &[seeds];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_token.to_account_info(),
                    to: ctx.accounts.user_token.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                signer,
            ),
            amount,
        )?;

        d.deposited = d
            .deposited
            .checked_sub(amount)
            .ok_or(error!(ErrorCode::Overflow))?;
        Ok(())
    }

    pub fn close_user_deposit_record(ctx: Context<CloseUserDepositCtx>) -> Result<()> {
        require!(
            ctx.accounts.user_deposit.deposited == 0,
            ErrorCode::NonZeroDeposited
        );
        Ok(())
    }

    pub fn close_vault_token_ata(ctx: Context<CloseVaultTokenCtx>) -> Result<()> {
        require!(
            ctx.accounts.vault_token.amount == 0,
            ErrorCode::NonEmptyVaultToken
        );

        let mint_key = ctx.accounts.vault.mint;
        let bump = ctx.accounts.vault.bump;
        let seeds: &[&[u8]] = &[b"vault", mint_key.as_ref(), &[bump]];
        let signer = &[seeds];

        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.vault_token.to_account_info(),
                destination: ctx.accounts.payer.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer,
        ))?;
        Ok(())
    }

    pub fn close_vault_state(_ctx: Context<CloseVaultStateCtx>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(
        init,
        payer = payer,
        space = 8 + VaultState::INIT_SPACE,
        seeds = [b"vault", mint.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, VaultState>,
    #[account(
        init,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = vault,
    )]
    pub vault_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositTokens<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, address = vault.mint)]
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [b"vault", mint.key().as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, VaultState>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = vault,
    )]
    pub vault_token: Account<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = user,
    )]
    pub user_token: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UserDeposit::INIT_SPACE,
        seeds = [b"deposit", vault.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub user_deposit: Account<'info, UserDeposit>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawTokens<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, address = vault.mint)]
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [b"vault", mint.key().as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, VaultState>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = vault,
    )]
    pub vault_token: Account<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = user,
    )]
    pub user_token: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"deposit", vault.key().as_ref(), user.key().as_ref()],
        bump = user_deposit.bump,
    )]
    pub user_deposit: Account<'info, UserDeposit>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CloseUserDepositCtx<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, address = vault.mint)]
    pub mint: Account<'info, Mint>,
    #[account(
        seeds = [b"vault", mint.key().as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, VaultState>,
    #[account(
        mut,
        close = user,
        seeds = [b"deposit", vault.key().as_ref(), user.key().as_ref()],
        bump = user_deposit.bump,
    )]
    pub user_deposit: Account<'info, UserDeposit>,
}

#[derive(Accounts)]
pub struct CloseVaultTokenCtx<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = vault.mint)]
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [b"vault", mint.key().as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, VaultState>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = vault,
    )]
    pub vault_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CloseVaultStateCtx<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = vault.mint)]
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        close = payer,
        seeds = [b"vault", mint.key().as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, VaultState>,
}

#[account]
#[derive(InitSpace)]
pub struct VaultState {
    pub mint: Pubkey,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct UserDeposit {
    pub deposited: u64,
    pub bump: u8,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Amount must be > 0")]
    ZeroAmount,
    #[msg("Cannot withdraw more than deposited")]
    InsufficientDeposited,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("User deposit must be zero before closing")]
    NonZeroDeposited,
    #[msg("Vault token account must be empty before closing")]
    NonEmptyVaultToken,
}
