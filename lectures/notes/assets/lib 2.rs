use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction, system_program,
    sysvar::Sysvar,
};

const USER_COUNTER_SEED: &[u8] = b"user_counter";
const USER_COUNTER_SPACE: usize = 8 + 32 + 1;

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub struct UserCounterState {
    pub count: u64,
    pub user: Pubkey,
    pub bump: u8,
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub enum UserCounterInstruction {
    InitUserCounter,
    Increment,
}

entrypoint!(process_instruction);

fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    input: &[u8],
) -> ProgramResult {
    let instruction = UserCounterInstruction::try_from_slice(input)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    match instruction {
        UserCounterInstruction::InitUserCounter => process_init_user_counter(program_id, accounts),
        UserCounterInstruction::Increment => process_increment(program_id, accounts),
    }
}

fn process_init_user_counter(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();

    let payer = next_account_info(accounts_iter)?;
    let user_counter_pda = next_account_info(accounts_iter)?;
    let system_program_account = next_account_info(accounts_iter)?;

    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    if *system_program_account.key != system_program::id() {
        return Err(ProgramError::IncorrectProgramId);
    }

    let seeds: &[&[u8]] = &[USER_COUNTER_SEED, payer.key.as_ref()];
    let (expected_pda, bump) = Pubkey::find_program_address(seeds, program_id);

    if expected_pda != *user_counter_pda.key {
        return Err(ProgramError::InvalidInstructionData);
    }

    if user_counter_pda.owner == program_id && user_counter_pda.data_len() > 0 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let rent = Rent::get()?;
    let required_lamports = rent.minimum_balance(USER_COUNTER_SPACE);

    msg!(
        "Init PDA: space={}, rent_exempt_lamports={}",
        USER_COUNTER_SPACE,
        required_lamports
    );

    invoke_signed(
        &system_instruction::create_account(
            payer.key,
            user_counter_pda.key,
            required_lamports,
            USER_COUNTER_SPACE as u64,
            program_id,
        ),
        &[
            payer.clone(),
            user_counter_pda.clone(),
            system_program_account.clone(),
        ],
        &[&[USER_COUNTER_SEED, payer.key.as_ref(), &[bump]]],
    )?;

    let state = UserCounterState {
        count: 0,
        user: *payer.key,
        bump,
    };
    state.serialize(&mut &mut user_counter_pda.data.borrow_mut()[..])?;

    Ok(())
}

fn process_increment(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();

    let user = next_account_info(accounts_iter)?;
    let user_counter_pda = next_account_info(accounts_iter)?;

    if !user.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    if user_counter_pda.owner != program_id {
        return Err(ProgramError::InvalidInstructionData);
    }

    let mut state = UserCounterState::try_from_slice(&user_counter_pda.data.borrow())
        .map_err(|_| ProgramError::InvalidAccountData)?;

    let (expected_pda, _) =
        Pubkey::find_program_address(&[USER_COUNTER_SEED, user.key.as_ref()], program_id);
    if expected_pda != *user_counter_pda.key {
        return Err(ProgramError::InvalidInstructionData);
    }

    if state.user != *user.key {
        return Err(ProgramError::InvalidInstructionData);
    }

    state.count = state
        .count
        .checked_add(1)
        .ok_or(ProgramError::InvalidInstructionData)?;
    state.serialize(&mut &mut user_counter_pda.data.borrow_mut()[..])?;

    msg!("Counter incremented. New value: {}", state.count);

    Ok(())
}
