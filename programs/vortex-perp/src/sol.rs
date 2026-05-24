use crate::errors::PerpError;
use crate::state::InsuranceFund;
use anchor_lang::prelude::*;

pub fn transfer_user_to_vault<'info>(
    from: &Signer<'info>,
    vault: &UncheckedAccount<'info>,
    system_program: &Program<'info, System>,
    lamports: u64,
) -> Result<()> {
    if lamports == 0 {
        return Ok(());
    }
    let cpi_accounts = anchor_lang::system_program::Transfer {
        from: from.to_account_info(),
        to: vault.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(system_program.to_account_info(), cpi_accounts);
    anchor_lang::system_program::transfer(cpi_ctx, lamports)
}

pub fn transfer_vault_to<'info>(
    vault: &UncheckedAccount<'info>,
    recipient: &AccountInfo<'info>,
    lamports: u64,
) -> Result<()> {
    let _ = recipient.owner;
    if lamports == 0 {
        return Ok(());
    }
    require!(
        **vault.to_account_info().lamports.borrow() >= lamports,
        PerpError::InsufficientCollateralVault
    );
    **vault.to_account_info().try_borrow_mut_lamports()? -= lamports;
    **recipient.try_borrow_mut_lamports()? += lamports;
    Ok(())
}

pub fn debit_insurance_to_account<'info>(
    insurance_fund: &mut Account<'info, InsuranceFund>,
    recipient: &AccountInfo<'info>,
    lamports: u64,
) -> Result<()> {
    if lamports == 0 {
        return Ok(());
    }
    require!(
        insurance_fund.balance >= lamports,
        PerpError::InsufficientInsuranceFund
    );
    require!(
        **insurance_fund.to_account_info().lamports.borrow() >= lamports,
        PerpError::InsufficientInsuranceFund
    );
    **insurance_fund.to_account_info().try_borrow_mut_lamports()? -= lamports;
    **recipient.try_borrow_mut_lamports()? += lamports;
    insurance_fund.balance = insurance_fund
        .balance
        .checked_sub(lamports)
        .ok_or(PerpError::MathOverflow)?;
    insurance_fund.total_payouts = insurance_fund
        .total_payouts
        .checked_add(lamports)
        .ok_or(PerpError::MathOverflow)?;
    Ok(())
}

pub fn credit_insurance_from_vault<'info>(
    vault: &UncheckedAccount<'info>,
    insurance_fund: &mut Account<'info, InsuranceFund>,
    lamports: u64,
) -> Result<()> {
    if lamports == 0 {
        return Ok(());
    }
    let recipient = insurance_fund.to_account_info();
    transfer_vault_to(vault, &recipient, lamports)?;
    insurance_fund.balance = insurance_fund
        .balance
        .checked_add(lamports)
        .ok_or(PerpError::MathOverflow)?;
    Ok(())
}
