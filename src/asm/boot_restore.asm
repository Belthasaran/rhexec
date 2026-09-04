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
; SA-1 is not restored. DSP voice envelopes are not poked (N-SPC may re-init).

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
        ; DMA WRAM, VRAM, CGRAM, OAM. Timed SPC IPL: 32KiB from $0000, then
        ; 1-byte IPL commands $8000–$FFBF (dest high bit7 cannot wait for the
        ; next index). Jump kick $80 (Y=1 after a 1-byte command). After $AA,
        ; wait timeout still jumps. No-$AA skip jumps IPL to STOP at $0386.
        ; Jump to $0386 trampoline (first 32KiB, below echo): restore GPRs, JMP aligned PC.
; APUIO/PPU/CPU MMIO are STA/LDA long ($00:xxxx) because DBR may not be 0.
; poke PPU (scrolls write-twice), $4300–$437F
; restore A,X,Y,DB,P then INIDISP + $4200 and jml !PC
