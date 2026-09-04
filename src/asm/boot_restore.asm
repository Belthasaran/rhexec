; Technique A boot-restore stub (assembled in src/boot/boot-restore.ts).
; Does not touch $05D89B / $05DCDD. Reset vector → bank-0 trampoline at $00FF70
; that JML's here (stub bank $8000).
;
; Payload LoROM banks after the stub bank:
;   +0..+3  WRAM 128KiB
;   +4..+5  VRAM 64KiB
;   +6..+7  ARAM 64KiB
; Stub bank $8600 CGRAM, $8800 OAM, $8A20 DMA regs.
;
; SA-1 is not restored. DSP regs are copied from a planted ARAM table; KON is
; write-triggered from captured ENVX (the KON register reads back 0).

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
        ; DMA WRAM, VRAM, CGRAM, OAM. One SPC IPL transfer dest $0000: 32KiB,
        ; then the same Trans continues $8000–$FFBF (Y=0 leftover $FF is not a
        ; new command). Jump kick $C1 (Y=$C0). No-$AA skip to STOP at $0386.
        ; Trampoline at $0386: DSP regs + KON, restore GPRs, JMP aligned PC.
; APUIO/PPU/CPU MMIO are STA/LDA long ($00:xxxx) because DBR may not be 0.
; poke PPU (scrolls write-twice), $4300–$437F
; restore A,X,Y,DB,P then INIDISP + $4200 and jml !PC
