export function getCurrentAccount(state) {
    if (state.accounts.length === 0) {
        return null;
    }
    const index = state.currentIndex ?? 0;
    return {
        name: state.accounts[index] ?? state.accounts[0],
        index: state.accounts[index] ? index : 0
    };
}
export function getAccountByName(state, accountName) {
    const index = state.accounts.indexOf(accountName);
    if (index === -1) {
        return null;
    }
    return {
        name: state.accounts[index],
        index
    };
}
export function pickNextAccount(accounts, currentIndex, exhausted) {
    if (accounts.length === 0) {
        return null;
    }
    for (let offset = 1; offset <= accounts.length; offset += 1) {
        const nextIndex = (currentIndex + offset) % accounts.length;
        const nextAccount = accounts[nextIndex];
        if (!exhausted.has(nextAccount)) {
            return {
                name: nextAccount,
                index: nextIndex
            };
        }
    }
    return null;
}
