# Anonymized fixtures

Sample bank payment notices used by parser tests. This is the only place where notice samples may live, and only after anonymization:

- Replace every name, phone number, account number and reference with fake values that keep the same format.
- Keep the exact layout, spacing and wording of the bank template, since parsers are anchored to it.
- Include hostile samples: descriptions that try to inject instructions or fake amounts.

Real notices never enter this repository.
