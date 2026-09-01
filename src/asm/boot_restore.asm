; Technique A MVP boot-restore stub (see src/boot/boot-restore.ts assembler).
; Does not touch $05D89B / $05DCDD. Reset vector is redirected to a bank-0 trampoline
; that JML's here. Payload is four LoROM banks of WRAM ($7E/$7F).
;
; APU / SA-1 restore intentionally omitted for the PoC.

        sei
        clc
        xce
        rep     #$30
        lda     #!D
        tcd
        ldx     #!SP
        txs
        sep     #$20
        lda     #$80
        sta     $2100
        lda     #$00
        sta     $4200
        ; 4x DMA $2180 WMDATA from payload banks
        ; then restore A,X,Y,DB,P and jml !PC
