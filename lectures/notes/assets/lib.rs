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
    system_instruction,
    sysvar::Sysvar,
};

#[derive(BorshDeserialize, BorshSerialize)]
pub struct State {
    pub value: u64,
}

#[derive(BorshDeserialize, BorshSerialize)]
pub enum MyIx {
    Init { amount: u64 },
    Update { value: u32 },
}

const STATE_SEED: &[u8] = b"state";

entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let ix = MyIx::try_from_slice(instruction_data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    match ix {
        MyIx::Init { amount } => {
            let account_iter = &mut accounts.iter();
            let payer = next_account_info(account_iter)?;
            let pda = next_account_info(account_iter)?;
            let system_program = next_account_info(account_iter)?;

            let (expected_pda, bump) =
                Pubkey::find_program_address(&[STATE_SEED], program_id);
            if pda.key != &expected_pda {
                return Err(ProgramError::InvalidSeeds);
            }
            if pda.owner == program_id && !pda.data_is_empty() {
                return Err(ProgramError::AccountAlreadyInitialized);
            }

            let rent = Rent::get()?;
            let space = std::mem::size_of::<State>() as u64;
            let lamports = rent.minimum_balance(space as usize);

            invoke_signed(
                &system_instruction::create_account(
                    payer.key,
                    pda.key,
                    lamports,
                    space,
                    program_id,
                ),
                &[payer.clone(), pda.clone(), system_program.clone()],
                &[&[STATE_SEED, &[bump]]],
            )?;

            let state = State { value: amount };
            state.serialize(&mut &mut pda.try_borrow_mut_data()?[..])?;

            msg!("Initialized value: {}", amount);
        }
        MyIx::Update { value } => {
            let account_iter = &mut accounts.iter();
            let pda = next_account_info(account_iter)?;

            let (expected_pda, _) = Pubkey::find_program_address(&[STATE_SEED], program_id);
            if pda.key != &expected_pda {
                return Err(ProgramError::InvalidSeeds);
            }
            if pda.owner != program_id {
                return Err(ProgramError::IllegalOwner);
            }

            let new_value = value as u64;
            let mut data = pda.try_borrow_mut_data()?;
            let mut state = State::try_from_slice(&data).map_err(|_| ProgramError::InvalidAccountData)?;
            state.value = new_value;
            state.serialize(&mut &mut data[..])?;

            msg!("Updated value: {}", new_value);
        }
    }

    Ok(())
}
