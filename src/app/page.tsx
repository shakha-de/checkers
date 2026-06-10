'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Swords, Loader2 } from 'lucide-react';
import styles from './page.module.css';

export default function Home() {
  const router = useRouter();
  const [color, setColor] = useState<'random' | 'w' | 'b'>('random');
  const [loading, setLoading] = useState(false);

  const handleCreateGame = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ creatorColor: color }),
      });

      if (!res.ok) {
        throw new Error('Failed to create room');
      }

      const data = await res.json();
      const { roomId, creatorToken } = data;

      // Store the session token locally for this room
      localStorage.setItem(`checkers_token_${roomId}`, creatorToken);

      // Redirect to the game room page
      router.push(`/rooms/${roomId}`);
    } catch (err) {
      console.error(err);
      alert('Ошибка при создании игры. Попробуйте еще раз.');
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={`${styles.mainCard} glass`}>
        <div className={styles.header}>
          <h1 className={styles.title}>ШАШКИ ОНЛАЙН</h1>
          <p className={styles.subtitle}>
            Создайте приватную комнату, отправьте ссылку другу и начните партию по правилам
            русских шашек!
          </p>
        </div>

        <div className={styles.formGroup}>
          <label className={styles.label}>Выберите ваш цвет</label>
          <div className={styles.colorSelector}>
            <div
              className={`${styles.colorOption} ${
                color === 'w' ? styles.colorOptionActive : ''
              }`}
              onClick={() => setColor('w')}
            >
              <div className={`${styles.colorDot} ${styles.colorDotWhite}`} />
              <span className={styles.colorName}>Белые</span>
            </div>

            <div
              className={`${styles.colorOption} ${
                color === 'random' ? styles.colorOptionActive : ''
              }`}
              onClick={() => setColor('random')}
            >
              <div className={`${styles.colorDot} ${styles.colorDotRandom}`} />
              <span className={styles.colorName}>Случайно</span>
            </div>

            <div
              className={`${styles.colorOption} ${
                color === 'b' ? styles.colorOptionActiveBlack : ''
              }`}
              onClick={() => setColor('b')}
            >
              <div className={`${styles.colorDot} ${styles.colorDotBlack}`} />
              <span className={styles.colorName}>Черные</span>
            </div>
          </div>
        </div>

        <button
          className={styles.submitBtn}
          onClick={handleCreateGame}
          disabled={loading}
        >
          {loading ? (
            <>
              <Loader2 className="animate-spin" size={20} />
              <span>Создание комнаты...</span>
            </>
          ) : (
            <>
              <Swords size={20} />
              <span>Создать игру</span>
            </>
          )}
        </button>

        <div className={styles.rules}>
          <h3 className={styles.rulesTitle}>Правила Русских Шашек:</h3>
          <ul className={styles.rulesList}>
            <li className={styles.ruleItem}>
              Простые шашки ходят по диагонали вперед, а бьют вперед и назад.
            </li>
            <li className={styles.ruleItem}>
              Взятие (битье) соперника обязательно. Если есть бой, другие ходы делать нельзя.
            </li>
            <li className={styles.ruleItem}>
              Дамка может ходить на любое число клеток по диагонали и бить на любом расстоянии.
            </li>
            <li className={styles.ruleItem}>
              Если простая шашка достигает последнего ряда при взятии, она сразу становится дамкой и
              продолжает бой (если возможно).
            </li>
            <li className={styles.ruleItem}>
              Срубленные шашки убираются с поля только в конце хода (правило турецкого удара).
            </li>
          </ul>
        </div>
      </div>
      <div className={styles.footer}>Разработано с заботой по правилам ФШР • 2026</div>
    </div>
  );
}
