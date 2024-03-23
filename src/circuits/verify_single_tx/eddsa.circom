pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/eddsaposeidon.circom";
include "../node_modules/circomlib/circuits/poseidon.circom";

template VerifyEdDSAPoseidon(k) {

    signal input from_x;
    signal input from_y;
    signal input R8x;
    signal input R8y;
    signal input S;
    signal input preimage[k];

    component M = Poseidon(k);
    for (var i = 0; i < k; i++) {
        M.inputs[i] <== preimage[i];
    }
    
    component verifier = EdDSAPoseidonVerifier();   
    verifier.enabled <== 1;
    verifier.Ax <== from_x;
    verifier.Ay <== from_y;
    verifier.R8x <== R8x;
    verifier.R8y <== R8y;
    verifier.S <== S;
    verifier.M <== M.out;
}

// component main {public [from_x, from_y, R8x, R8y, S, M]} = VerifyEdDSAPoseidon();