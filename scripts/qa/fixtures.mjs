// Small controlled fixtures for QA scenarios (spec §115 / §116). All data is clearly synthetic.
export const LONG_UPI =
  'UPI-MR A MANIKANDAN-9578379800-2@YBL-CIUB0000476-621367896104-LUNCHUPI-JEEVAJEEVA534571OKAX-JEEVAJEEVA53457-1@OKAXIS-YESB0001350-657900506223-TEA'

// Controlled QIF: expense, income, payee, memo, category, date (+ a duplicate pair and an invalid record).
export const QIF = [
  '!Type:Bank',
  'D12/10/2026', 'T-180.00', 'PSWIGGY', 'MOrder 12345 dinner', 'LDining', '^',
  'D13/10/2026', 'T-320.00', 'PABC BRIYANI RESTAURANT', 'MLunch with team', '^',
  'D14/10/2026', 'T-90.00', 'PDOSA CORNER', '^',
  'D15/10/2026', 'T65000.00', 'PACME CORP SALARY', 'MOctober salary', 'LIncome', '^',
  'D16/10/2026', 'T-1,299.00', 'PNETFLIX.COM', 'LSubscriptions', '^',
  'D17/10/2026', 'T-45.50', 'PTEA POINT', '^',
  'D17/10/2026', 'T-45.50', 'PTEA POINT', '^', // identical row inside the same file = genuine repeat
  'DNOT-A-DATE', 'T-10.00', 'PBROKEN RECORD', '^',
  ''
].join('\r\n')
